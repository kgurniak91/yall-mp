import type {AssSubtitleData} from '../shared/types/subtitle.type';
import type {VideoClip} from '../src/app/model/video.types';

export const MOCK_VIDEO_DURATION = 1000;

export interface TestCase {
  description: string;
  dialogueLines: string;
  expectedSubtitleData: AssSubtitleData[];
  expectedVideoClips: Partial<VideoClip>[];
}

export const TEST_CASES: TestCase[] = [
  {
    description: 'Simple Case - Single Dialogue Line',
    dialogueLines: `Dialogue: 10,0:00:16.39,0:00:19.08,Default,,0,0,0,,Still good, but it'll go bad soon. Close one!`,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 16.39,
        endTime: 19.08,
        parts: [{text: "Still good, but it'll go bad soon. Close one!", style: "Default"}]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 16.39, hasSubtitle: false},
      {
        id: 'subtitle-16.39',
        startTime: 16.39,
        endTime: 19.08,
        hasSubtitle: true,
        parts: [{text: "Still good, but it'll go bad soon. Close one!", style: "Default"}]
      },
      {id: 'gap-19.08', startTime: 19.08, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Concurrent Lines with Different Styles',
    dialogueLines: `
      Dialogue: 10,0:01:02.58,0:01:04.24,Default,,0,0,0,,Amazing.
      Dialogue: 10,0:01:02.58,0:01:04.24,Sign-Default,,0,0,0,,Amazing.
    `,
    expectedSubtitleData: [
      {type: 'ass', id: 'test-id-0', startTime: 62.58, endTime: 64.24, parts: [{text: 'Amazing.', style: 'Default'}]},
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 62.58,
        endTime: 64.24,
        parts: [{text: 'Amazing.', style: 'Sign-Default'}]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 62.58, hasSubtitle: false},
      {
        id: 'subtitle-62.58',
        startTime: 62.58,
        endTime: 64.24,
        hasSubtitle: true,
        parts: [{text: 'Amazing.', style: 'Default'}, {text: 'Amazing.', style: 'Sign-Default'}]
      },
      {id: 'gap-64.24', startTime: 64.24, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Duplicate Text on Different Layers for Effects',
    dialogueLines: `
      Dialogue: 0,0:00:25.58,0:00:29.96,Sign-Default,,0,0,0,,Not Edible
      Dialogue: 1,0:00:25.58,0:00:29.96,Sign-Default,,0,0,0,,Not Edible
      Dialogue: 10,0:00:26.77,0:00:29.34,Default,,0,0,0,,Strike!
    `,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 25.58,
        endTime: 29.96,
        parts: [{text: 'Not Edible', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 25.58,
        endTime: 29.96,
        parts: [{text: 'Not Edible', style: 'Sign-Default'}]
      },
      {type: 'ass', id: 'test-id-2', startTime: 26.77, endTime: 29.34, parts: [{text: 'Strike!', style: 'Default'}]}
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 25.58, hasSubtitle: false},
      {
        id: 'subtitle-25.58',
        startTime: 25.58,
        endTime: 26.77,
        hasSubtitle: true,
        parts: [{text: 'Not Edible', style: 'Sign-Default'}]
      },
      {
        id: 'subtitle-26.77',
        startTime: 26.77,
        endTime: 29.34,
        hasSubtitle: true,
        parts: [{text: 'Not Edible', style: 'Sign-Default'}, {text: 'Strike!', style: 'Default'}]
      },
      {
        id: 'subtitle-29.34',
        startTime: 29.34,
        endTime: 29.96,
        hasSubtitle: true,
        parts: [{text: 'Not Edible', style: 'Sign-Default'}]
      },
      {id: 'gap-29.96', startTime: 29.96, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Long-running title over two separate, consecutive dialogues',
    dialogueLines: `
      Dialogue: 10,0:00:33.97,0:00:36.62,Default,,0,0,0,,Much More Railgun!
      Dialogue: 0,0:00:33.97,0:00:40.47,mmr3title,,0,0,0,,Much More Railgun Ⅲ
      Dialogue: 10,0:00:36.62,0:00:40.47,Default,,0,0,0,,MMR!
    `,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 33.97,
        endTime: 36.62,
        parts: [{text: 'Much More Railgun!', style: 'Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 33.97,
        endTime: 40.47,
        parts: [{text: 'Much More Railgun Ⅲ', style: 'mmr3title'}]
      },
      {type: 'ass', id: 'test-id-2', startTime: 36.62, endTime: 40.47, parts: [{text: 'MMR!', style: 'Default'}]}
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 33.97, hasSubtitle: false},
      {
        id: 'subtitle-33.97',
        startTime: 33.97,
        endTime: 36.62,
        hasSubtitle: true,
        parts: [{text: 'Much More Railgun!', style: 'Default'}, {text: 'Much More Railgun Ⅲ', style: 'mmr3title'}]
      },
      {
        id: 'subtitle-36.62',
        startTime: 36.62,
        endTime: 40.47,
        hasSubtitle: true,
        parts: [{text: 'Much More Railgun Ⅲ', style: 'mmr3title'}, {text: 'MMR!', style: 'Default'}]
      },
      {id: 'gap-40.47', startTime: 40.47, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Animation with consecutive identical parts',
    dialogueLines: `
      Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,Real Usable
      Dialogue: 0,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,English Lesson
      Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,English Lesson
      Dialogue: 1,0:00:59.53,0:00:59.58,Sign-Default,,0,0,0,,Real Usable
      Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,Real Usable
      Dialogue: 0,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,English Lesson
      Dialogue: 1,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,English Lesson
      Dialogue: 1,0:00:59.58,0:00:59.62,Sign-Default,,0,0,0,,Real Usable
      Dialogue: 0,0:00:59.62,0:00:59.66,Sign-Default,,0,0,0,,Real Usable
      Dialogue: 0,0:00:59.62,0:00:59.66,Sign-Default,,0,0,0,,English Lesson
    `,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'Real Usable', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'English Lesson', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-2',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'English Lesson', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-3',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'Real Usable', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-4',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'Real Usable', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-5',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'English Lesson', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-6',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'English Lesson', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-7',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'Real Usable', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-8',
        startTime: 59.62,
        endTime: 59.66,
        parts: [{text: 'Real Usable', style: 'Sign-Default'}]
      },
      {
        type: 'ass',
        id: 'test-id-9',
        startTime: 59.62,
        endTime: 59.66,
        parts: [{text: 'English Lesson', style: 'Sign-Default'}]
      },
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 59.53, hasSubtitle: false},
      {
        id: 'subtitle-59.53', startTime: 59.53, endTime: 59.66, hasSubtitle: true,
        parts: [
          {text: 'English Lesson', style: 'Sign-Default'},
          {text: 'Real Usable', style: 'Sign-Default'}
        ]
      },
      {id: 'gap-59.66', startTime: 59.66, endTime: 1000, hasSubtitle: false}
    ]
  }
];
