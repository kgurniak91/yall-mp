import {computed, inject, Injectable, signal} from '@angular/core';
import {AnkiCardTemplate, AnkiConnectStatus} from '../../model/anki.types';
import {AppStateService} from '../app/app-state.service';
import {ToastService} from '../../shared/services/toast/toast.service';

@Injectable({
  providedIn: 'root'
})
export class AnkiStateService {
  readonly status = signal<AnkiConnectStatus>(AnkiConnectStatus.disconnected);
  readonly deckNames = signal<string[]>([]);
  readonly noteTypes = signal<string[]>([]);
  readonly noteTypeFields = signal<Record<string, string[]>>({});
  readonly isLoadingDecks = signal(false);
  readonly isLoadingNoteTypes = signal(false);
  readonly isLoadingNoteTypeFields = signal(false);
  readonly ankiCardTemplates = computed(() => this.appStateService.ankiSettings().ankiCardTemplates);
  readonly isAnkiExportAvailable = signal(false);
  readonly ankiGlobalTags = computed(() => this.appStateService.ankiSettings().tags);
  readonly progressTracker = computed(() => this.appStateService.ankiSettings().progressTracker || {});
  private readonly appStateService = inject(AppStateService);
  private readonly toastService = inject(ToastService);

  constructor() {
    this.checkAnkiConnection();
    this.checkFFmpegAvailability();
  }

  async checkAnkiConnection(): Promise<void> {
    this.status.set(AnkiConnectStatus.checking);

    try {
      const result = await window.electronAPI.checkAnkiConnection();

      if ((result !== null) && (typeof result === 'number')) {
        this.status.set(AnkiConnectStatus.connected);
        await Promise.all([
          this.fetchDeckNames(),
          this.fetchNoteTypes()
        ]);
      } else {
        this.status.set(AnkiConnectStatus.disconnected);
        this.deckNames.set([]);
        this.noteTypes.set([]);
      }
    } catch (e) {
      this.status.set(AnkiConnectStatus.error);
      this.deckNames.set([]);
      this.noteTypes.set([]);
    }
  }

  private async checkFFmpegAvailability(): Promise<void> {
    const isAvailable = await window.electronAPI.checkFFmpegAvailability();
    this.isAnkiExportAvailable.set(isAvailable);
  }

  async fetchDeckNames(): Promise<void> {
    if (this.status() !== AnkiConnectStatus.connected) {
      return;
    }

    this.isLoadingDecks.set(true);
    try {
      const names = await window.electronAPI.getAnkiDeckNames();
      if (names) {
        this.deckNames.set(names.sort());
        console.log('Fetched deck names:', names);
      } else {
        this.deckNames.set([]);
        console.error('Failed to fetch deck names, API returned null.');
      }
    } catch (e) {
      console.error('An unexpected error occurred while fetching deck names:', e);
      this.deckNames.set([]);
    } finally {
      this.isLoadingDecks.set(false);
    }
  }

  async fetchNoteTypes(): Promise<void> {
    if (this.status() !== AnkiConnectStatus.connected) {
      return;
    }

    this.isLoadingNoteTypes.set(true);
    try {
      const names = await window.electronAPI.getAnkiNoteTypes();
      if (names) {
        this.noteTypes.set(names.sort());
        console.log('Fetched note types:', names);
      } else {
        this.noteTypes.set([]);
        console.error('Failed to fetch note types, API returned null.');
      }
    } catch (e) {
      console.error('An unexpected error occurred while fetching note types:', e);
      this.noteTypes.set([]);
    } finally {
      this.isLoadingNoteTypes.set(false);
    }
  }

  async fetchNoteTypeFields(noteTypeName: string): Promise<string[]> {
    if (this.status() !== AnkiConnectStatus.connected || !noteTypeName) {
      return [];
    }

    // Return cached data if it already exists
    if (this.noteTypeFields()[noteTypeName]) {
      return this.noteTypeFields()[noteTypeName];
    }

    this.isLoadingNoteTypeFields.set(true);
    try {
      const names = await window.electronAPI.getAnkiNoteTypeFieldNames(noteTypeName);
      const finalNames = names || [];
      this.noteTypeFields.update(data => ({...data, [noteTypeName]: finalNames}));
      return finalNames;
    } catch (e) {
      console.error(`Failed to fetch fields for ${noteTypeName}`, e);
      return [];
    } finally {
      this.isLoadingNoteTypeFields.set(false);
    }
  }

  addAnkiCardTemplate(template: AnkiCardTemplate): void {
    const currentTemplates = this.ankiCardTemplates();
    this.appStateService.updateAnkiSettings({ankiCardTemplates: [...currentTemplates, template]});
  }

  updateAnkiCardTemplate(id: string, updates: AnkiCardTemplate): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.map(t => t.id === id ? updates : t);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

  deleteCardTemplate(id: string): void {
    const currentTemplates = this.ankiCardTemplates();
    const newTemplates = currentTemplates.filter(t => t.id !== id);
    this.appStateService.updateAnkiSettings({ankiCardTemplates: newTemplates});
  }

  setAnkiGlobalTags(tags: string[]): void {
    this.appStateService.updateAnkiSettings({tags});
  }

  getTodayDateString(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  syncDailyGoalNotificationState(templateId: string, newTargetCount: number, isEnabled: boolean): void {
    const today = this.getTodayDateString();
    const currentSettings = this.appStateService.ankiSettings();
    const progressTracker = currentSettings.progressTracker || {};
    const todayProgress = progressTracker[today] || {};
    const templateProgress = todayProgress[templateId];

    if (!templateProgress) {
      return;
    }

    let shouldBeNotified = templateProgress.goalReachedNotified;

    if (templateProgress.count < newTargetCount) {
      // Goalpost moved further away - reset the flag so it can reach it again
      shouldBeNotified = false;
    } else if (isEnabled && templateProgress.count >= newTargetCount) {
      // Goal enabled/lowered and progress is ALREADY past it:
      // Silently mark as reached to avoid spamming the fanfare on the next single export
      shouldBeNotified = true;
    }

    if (shouldBeNotified !== templateProgress.goalReachedNotified) {
      const newProgressTracker = {
        ...progressTracker,
        [today]: {
          ...todayProgress,
          [templateId]: {...templateProgress, goalReachedNotified: shouldBeNotified}
        }
      };
      this.appStateService.updateAnkiSettings({progressTracker: newProgressTracker});
    }
  }

  async processDailyGoalProgress(templateId: string, count: number = 1): Promise<void> {
    const templates = this.ankiCardTemplates();
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      return;
    }

    // Always track the export count for this template today
    const today = this.getTodayDateString();
    const currentSettings = this.appStateService.ankiSettings();
    const progressTracker = currentSettings.progressTracker || {};
    const todayProgress = progressTracker[today] || {};
    const templateProgress = todayProgress[templateId] || {count: 0, goalReachedNotified: false};

    const newProgress = {
      ...templateProgress,
      count: templateProgress.count + count
    };

    const newProgressTracker = {
      ...progressTracker,
      [today]: {
        ...todayProgress,
        [templateId]: newProgress
      }
    };

    // Garbage collection: Keep only the last 7 days of history
    const keys = Object.keys(newProgressTracker).sort();
    if (keys.length > 7) {
      const keysToRemove = keys.slice(0, keys.length - 7);
      keysToRemove.forEach(k => delete newProgressTracker[k]);
    }

    this.appStateService.updateAnkiSettings({progressTracker: newProgressTracker});

    // Process Notifications ONLY if a goal exists and is enabled
    const goal = template.dailyGoal;
    if (!goal || !goal.enabled) {
      return;
    }

    // Check if goal is reached for the first time today
    if (newProgress.count >= goal.targetCount && !newProgress.goalReachedNotified) {
      this.toastService.dailyGoalReached(template.name, goal.targetCount);
      if (goal.playSound) {
        this.playFanfare();
      }

      // Update flag immediately to avoid notifying twice
      const finalProgressTracker = {
        ...newProgressTracker,
        [today]: {
          ...newProgressTracker[today],
          [templateId]: {...newProgress, goalReachedNotified: true}
        }
      };
      this.appStateService.updateAnkiSettings({progressTracker: finalProgressTracker});
      return;
    }

    // Check if it should notify after reaching the goal
    if (newProgress.count > goal.targetCount) {
      if (goal.notifyAfterReached && goal.notifyInterval > 0) {
        if (newProgress.count % goal.notifyInterval === 0) {
          this.toastService.dailyGoalProgress(template.name, newProgress.count, goal.targetCount);
        }
      }
      return;
    }

    // Normal progress notification
    if (goal.notifyInterval > 0 && newProgress.count < goal.targetCount) {
      const previousCount = newProgress.count - count;
      const previousMultiple = Math.floor(previousCount / goal.notifyInterval);
      const currentMultiple = Math.floor(newProgress.count / goal.notifyInterval);

      if (currentMultiple > previousMultiple) {
        this.toastService.dailyGoalProgress(template.name, newProgress.count, goal.targetCount);
      }
    }
  }

  private playFanfare(): void {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioCtx = new AudioContextClass();
      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = audioCtx.currentTime;
      playTone(523.25, now, 0.2); // C5
      playTone(659.25, now + 0.15, 0.2); // E5
      playTone(783.99, now + 0.3, 0.4); // G5
      playTone(1046.50, now + 0.45, 0.6); // C6
    } catch (e) {
      console.warn('Web Audio API fanfare failed', e);
    }
  }
}
