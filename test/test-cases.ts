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
        parts: [{
          text: "Still good, but it'll go bad soon. Close one!",
          style: "Default",
          fragments: [{text: "Still good, but it'll go bad soon. Close one!", isTag: false}]
        }]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 16.39, hasSubtitle: false},
      {
        id: 'subtitle-16.39',
        startTime: 16.39,
        endTime: 19.08,
        hasSubtitle: true,
        parts: [{
          text: "Still good, but it'll go bad soon. Close one!",
          style: "Default",
          fragments: [{text: "Still good, but it'll go bad soon. Close one!", isTag: false}]
        }]
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
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 62.58,
        endTime: 64.24,
        parts: [{text: 'Amazing.', style: 'Default', fragments: [{text: 'Amazing.', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 62.58,
        endTime: 64.24,
        parts: [{text: 'Amazing.', style: 'Sign-Default', fragments: [{text: 'Amazing.', isTag: false}]}]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 62.58, hasSubtitle: false},
      {
        id: 'subtitle-62.58',
        startTime: 62.58,
        endTime: 64.24,
        hasSubtitle: true,
        parts: [
          {text: 'Amazing.', style: 'Default', fragments: [{text: 'Amazing.', isTag: false}]},
          {text: 'Amazing.', style: 'Sign-Default', fragments: [{text: 'Amazing.', isTag: false}]}
        ]
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
        parts: [{text: 'Not Edible', style: 'Sign-Default', fragments: [{text: 'Not Edible', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 25.58,
        endTime: 29.96,
        parts: [{text: 'Not Edible', style: 'Sign-Default', fragments: [{text: 'Not Edible', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-2',
        startTime: 26.77,
        endTime: 29.34,
        parts: [{text: 'Strike!', style: 'Default', fragments: [{text: 'Strike!', isTag: false}]}]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 25.58, hasSubtitle: false},
      {
        id: 'subtitle-25.58',
        startTime: 25.58,
        endTime: 26.77,
        hasSubtitle: true,
        parts: [{text: 'Not Edible', style: 'Sign-Default', fragments: [{text: 'Not Edible', isTag: false}]}]
      },
      {
        id: 'subtitle-26.77',
        startTime: 26.77,
        endTime: 29.34,
        hasSubtitle: true,
        parts: [
          {text: 'Not Edible', style: 'Sign-Default', fragments: [{text: 'Not Edible', isTag: false}]},
          {text: 'Strike!', style: 'Default', fragments: [{text: 'Strike!', isTag: false}]}
        ]
      },
      {
        id: 'subtitle-29.34',
        startTime: 29.34,
        endTime: 29.96,
        hasSubtitle: true,
        parts: [{text: 'Not Edible', style: 'Sign-Default', fragments: [{text: 'Not Edible', isTag: false}]}]
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
        parts: [{text: 'Much More Railgun!', style: 'Default', fragments: [{text: 'Much More Railgun!', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 33.97,
        endTime: 40.47,
        parts: [{
          text: 'Much More Railgun Ⅲ',
          style: 'mmr3title',
          fragments: [{text: 'Much More Railgun Ⅲ', isTag: false}]
        }]
      },
      {
        type: 'ass',
        id: 'test-id-2',
        startTime: 36.62,
        endTime: 40.47,
        parts: [{text: 'MMR!', style: 'Default', fragments: [{text: 'MMR!', isTag: false}]}]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 33.97, hasSubtitle: false},
      {
        id: 'subtitle-33.97',
        startTime: 33.97,
        endTime: 36.62,
        hasSubtitle: true,
        parts: [
          {text: 'Much More Railgun!', style: 'Default', fragments: [{text: 'Much More Railgun!', isTag: false}]},
          {text: 'Much More Railgun Ⅲ', style: 'mmr3title', fragments: [{text: 'Much More Railgun Ⅲ', isTag: false}]}
        ]
      },
      {
        id: 'subtitle-36.62',
        startTime: 36.62,
        endTime: 40.47,
        hasSubtitle: true,
        parts: [
          {text: 'Much More Railgun Ⅲ', style: 'mmr3title', fragments: [{text: 'Much More Railgun Ⅲ', isTag: false}]},
          {text: 'MMR!', style: 'Default', fragments: [{text: 'MMR!', isTag: false}]}
        ]
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
        parts: [{text: 'Real Usable', style: 'Sign-Default', fragments: [{text: 'Real Usable', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'English Lesson', style: 'Sign-Default', fragments: [{text: 'English Lesson', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-2',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'English Lesson', style: 'Sign-Default', fragments: [{text: 'English Lesson', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-3',
        startTime: 59.53,
        endTime: 59.58,
        parts: [{text: 'Real Usable', style: 'Sign-Default', fragments: [{text: 'Real Usable', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-4',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'Real Usable', style: 'Sign-Default', fragments: [{text: 'Real Usable', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-5',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'English Lesson', style: 'Sign-Default', fragments: [{text: 'English Lesson', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-6',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'English Lesson', style: 'Sign-Default', fragments: [{text: 'English Lesson', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-7',
        startTime: 59.58,
        endTime: 59.62,
        parts: [{text: 'Real Usable', style: 'Sign-Default', fragments: [{text: 'Real Usable', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-8',
        startTime: 59.62,
        endTime: 59.66,
        parts: [{text: 'Real Usable', style: 'Sign-Default', fragments: [{text: 'Real Usable', isTag: false}]}]
      },
      {
        type: 'ass',
        id: 'test-id-9',
        startTime: 59.62,
        endTime: 59.66,
        parts: [{text: 'English Lesson', style: 'Sign-Default', fragments: [{text: 'English Lesson', isTag: false}]}]
      },
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 59.53, hasSubtitle: false},
      {
        id: 'subtitle-59.53', startTime: 59.53, endTime: 59.66, hasSubtitle: true,
        parts: [
          {text: 'English Lesson', style: 'Sign-Default', fragments: [{text: 'English Lesson', isTag: false}]},
          {text: 'Real Usable', style: 'Sign-Default', fragments: [{text: 'Real Usable', isTag: false}]}
        ]
      },
      {id: 'gap-59.66', startTime: 59.66, endTime: 1000, hasSubtitle: false}
    ]
  },
  {
    description: 'Line with inline styling tags',
    dialogueLines: `Dialogue: 10,0:00:50.23,0:00:53.48,Default,,0,0,0,,{\\i1}Anata{\\i0} look like you suck at {\\i1}Eigo{\\i0}.`,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 50.23,
        endTime: 53.48,
        parts: [{
          text: 'Anata look like you suck at Eigo.',
          style: 'Default',
          fragments: [
            {text: '{\\i1}', isTag: true},
            {text: 'Anata', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: ' look like you suck at ', isTag: false},
            {text: '{\\i1}', isTag: true},
            {text: 'Eigo', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: '.', isTag: false}
          ]
        }]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 50.23, hasSubtitle: false},
      {
        id: 'subtitle-50.23',
        startTime: 50.23,
        endTime: 53.48,
        hasSubtitle: true,
        parts: [{
          text: 'Anata look like you suck at Eigo.',
          style: 'Default',
          fragments: [
            {text: '{\\i1}', isTag: true},
            {text: 'Anata', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: ' look like you suck at ', isTag: false},
            {text: '{\\i1}', isTag: true},
            {text: 'Eigo', isTag: false},
            {text: '{\\i0}', isTag: true},
            {text: '.', isTag: false}
          ]
        }]
      },
      {id: 'gap-53.48', startTime: 53.48, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Correctly parses complex line with mixed animation and inline tags',
    dialogueLines: `
Dialogue: 0,0:01:26.52,0:01:30.52,mmr3title,,0,0,0,,{\\fnA-OTF Jun Pro MMR3 34\\fs19\\an7\\bord9\\blur7\\fsp6\\c&H3974E9&\\4c&H000000&\\4a&HFF&\\3c&HFFFFFF&\\pos(1454,838)}Much More Railgun{\\fscx60} {\\fs16\\fscx100}Ⅲ
Dialogue: 1,0:01:26.52,0:01:30.52,mmr3title,,0,0,0,,{\\fnA-OTF Jun Pro MMR3 34\\fs19\\an7\\bord1.8\\blur0\\fsp6\\c&H3974E9&\\4c&H000000&\\4a&HFF&\\3c&H423A80&\\pos(1454,838)}Much More Railgun{\\fscx60} {\\fs16\\fscx100}Ⅲ
    `,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 86.52,
        endTime: 90.52,
        parts: [{
          text: 'Much More Railgun Ⅲ',
          style: 'mmr3title',
          fragments: [
            {
              text: '{\\fnA-OTF Jun Pro MMR3 34\\fs19\\an7\\bord9\\blur7\\fsp6\\c&H3974E9&\\4c&H000000&\\4a&HFF&\\3c&HFFFFFF&\\pos(1454,838)}',
              isTag: true
            },
            {text: 'Much More Railgun', isTag: false},
            {text: '{\\fscx60}', isTag: true},
            {text: ' ', isTag: false},
            {text: '{\\fs16\\fscx100}', isTag: true},
            {text: 'Ⅲ', isTag: false}
          ]
        }]
      },
      {
        type: 'ass',
        id: 'test-id-1',
        startTime: 86.52,
        endTime: 90.52,
        parts: [{
          text: 'Much More Railgun Ⅲ',
          style: 'mmr3title',
          fragments: [
            {
              text: '{\\fnA-OTF Jun Pro MMR3 34\\fs19\\an7\\bord1.8\\blur0\\fsp6\\c&H3974E9&\\4c&H000000&\\4a&HFF&\\3c&H423A80&\\pos(1454,838)}',
              isTag: true
            },
            {text: 'Much More Railgun', isTag: false},
            {text: '{\\fscx60}', isTag: true},
            {text: ' ', isTag: false},
            {text: '{\\fs16\\fscx100}', isTag: true},
            {text: 'Ⅲ', isTag: false}
          ]
        }]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 86.52, hasSubtitle: false},
      {
        id: 'subtitle-86.52',
        startTime: 86.52,
        endTime: 90.52,
        hasSubtitle: true,
        parts: [
          {
            text: 'Much More Railgun Ⅲ',
            style: 'mmr3title',
            fragments: [
              {
                text: '{\\fnA-OTF Jun Pro MMR3 34\\fs19\\an7\\bord9\\blur7\\fsp6\\c&H3974E9&\\4c&H000000&\\4a&HFF&\\3c&HFFFFFF&\\pos(1454,838)}',
                isTag: true
              },
              {text: 'Much More Railgun', isTag: false},
              {text: '{\\fscx60}', isTag: true},
              {text: ' ', isTag: false},
              {text: '{\\fs16\\fscx100}', isTag: true},
              {text: 'Ⅲ', isTag: false}
            ]
          }
        ]
      },
      {id: 'gap-90.52', startTime: 90.52, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Ignores ASS drawing commands',
    dialogueLines: `
      Dialogue: 0,0:00:29.96,0:00:33.97,Sign-Default,,150,0,0,,{\\p1}m -63 -24 l -63 21 l 51 21 l 51 -24
      Dialogue: 1,0:00:29.96,0:00:33.97,Sign-Default,,150,0,0,,{\\an4}Real subtitle text.
    `,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 29.96,
        endTime: 33.97,
        parts: [{
          text: 'Real subtitle text.',
          style: 'Sign-Default',
          fragments: [
            {text: '{\\an4}', isTag: true},
            {text: 'Real subtitle text.', isTag: false}
          ]
        }]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 29.96, hasSubtitle: false},
      {
        id: 'subtitle-29.96',
        startTime: 29.96,
        endTime: 33.97,
        hasSubtitle: true,
        parts: [{
          text: 'Real subtitle text.',
          style: 'Sign-Default',
          fragments: [
            {text: '{\\an4}', isTag: true},
            {text: 'Real subtitle text.', isTag: false}
          ]
        }]
      },
      {id: 'gap-33.97', startTime: 33.97, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  },
  {
    description: 'Handles newlines (\\N) within a single fragment',
    dialogueLines: `Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,First line.\\NSecond line.`,
    expectedSubtitleData: [
      {
        type: 'ass',
        id: 'test-id-0',
        startTime: 10.00,
        endTime: 15.00,
        parts: [{
          text: 'First line.\nSecond line.',
          style: 'Default',
          fragments: [
            {text: 'First line.\nSecond line.', isTag: false}
          ]
        }]
      }
    ],
    expectedVideoClips: [
      {id: 'gap-0', startTime: 0, endTime: 10.00, hasSubtitle: false},
      {
        id: 'subtitle-10',
        startTime: 10.00,
        endTime: 15.00,
        hasSubtitle: true,
        parts: [{
          text: 'First line.\nSecond line.',
          style: 'Default',
          fragments: [
            {text: 'First line.\nSecond line.', isTag: false}
          ]
        }]
      },
      {id: 'gap-15', startTime: 15.00, endTime: MOCK_VIDEO_DURATION, hasSubtitle: false},
    ]
  }
];
