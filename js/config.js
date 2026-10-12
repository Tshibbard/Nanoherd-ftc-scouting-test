// Season configuration. Everything game-specific lives here so a new season
// only needs a new config object (field list + point values).
//
// BIOBUZZ (2026-2027) point values, from Competition Manual Table 10-2:
//   AUTO LEAVE 3, PARK 5 (end of AUTO and end of MATCH), HIVE TIP 20,
//   piece remaining in a CELL 2, Bottom NECTAR Bonus 5,
//   piece in an owned FLOWER 2, piece in a GARDEN 1.
// Double-check these against the current manual and team updates; edit
// `points` below if they change.

export const SEASONS = {
  '2627': {
    key: '2627',
    name: 'BIOBUZZ',
    years: '2026-2027',

    // Match scouting fields. Each field:
    //   id      short, stable key (also used in the QR encoding, so never reuse one)
    //   label   shown on screen
    //   type    'toggle' | 'counter' | 'select' | 'rating' | 'text'
    //   phase   'auto' | 'teleop' | 'endgame' | 'other'
    //   points  points earned per unit (toggle = 1 unit, counter = count)
    //   options for 'select'
    matchFields: [
      { id: 'aLeave', label: 'LEAVE (left starting area)', type: 'toggle', phase: 'auto', points: 3 },
      { id: 'aCell', label: 'Pieces into HIVE CELLS', type: 'counter', phase: 'auto', points: 2 },
      { id: 'aMiss', label: 'Missed shots', type: 'counter', phase: 'auto', points: 0 },
      { id: 'aTip', label: 'HIVE TIPs completed', type: 'counter', phase: 'auto', points: 20 },
      { id: 'aPark', label: 'PARK in LOADING ZONE at end of AUTO', type: 'toggle', phase: 'auto', points: 5 },

      { id: 'tCell', label: 'Pieces into HIVE CELLS', type: 'counter', phase: 'teleop', points: 2 },
      { id: 'tMiss', label: 'Missed shots', type: 'counter', phase: 'teleop', points: 0 },
      { id: 'tTip', label: 'HIVE TIPs completed', type: 'counter', phase: 'teleop', points: 20 },
      { id: 'tGarden', label: 'Pieces into GARDEN', type: 'counter', phase: 'teleop', points: 1 },
      { id: 'tFlower', label: 'POLLEN into FLOWER', type: 'counter', phase: 'teleop', points: 2 },
      { id: 'tDef', label: 'Played defense', type: 'toggle', phase: 'teleop', points: 0 },

      { id: 'eNectar', label: 'NECTAR into FLOWER (last 60 s)', type: 'counter', phase: 'endgame', points: 2 },
      { id: 'eBottom', label: 'Earned Bottom NECTAR Bonus', type: 'counter', phase: 'endgame', points: 5 },
      { id: 'eOwn', label: 'Claimed FLOWER ownership (top NECTAR)', type: 'toggle', phase: 'endgame', points: 0 },
      { id: 'ePark', label: 'PARK in LOADING ZONE at end of MATCH', type: 'toggle', phase: 'endgame', points: 5 },

      { id: 'oDriver', label: 'Driver skill', type: 'rating', phase: 'other', points: 0 },
      { id: 'oDefRate', label: 'Defense effectiveness', type: 'rating', phase: 'other', points: 0 },
      { id: 'oMinor', label: 'MINOR fouls', type: 'counter', phase: 'other', points: 0 },
      { id: 'oMajor', label: 'MAJOR fouls', type: 'counter', phase: 'other', points: 0 },
      { id: 'oDead', label: 'Robot died / disconnected', type: 'toggle', phase: 'other', points: 0 },
      { id: 'oNoShow', label: 'No show', type: 'toggle', phase: 'other', points: 0 },
      { id: 'oNotes', label: 'Notes', type: 'text', phase: 'other', points: 0 },
    ],

    // Pit scouting fields (same shape, no points).
    pitFields: [
      { id: 'drive', label: 'Drivetrain', type: 'select', options: ['Mecanum', 'Tank', 'Swerve', 'X-drive', 'Other'] },
      { id: 'width', label: 'Width (in)', type: 'number' },
      { id: 'length', label: 'Length (in)', type: 'number' },
      { id: 'pollen', label: 'Can handle POLLEN', type: 'toggle' },
      { id: 'nectar', label: 'Can handle NECTAR', type: 'toggle' },
      { id: 'floorPick', label: 'Intakes from floor', type: 'toggle' },
      { id: 'hive', label: 'Scores into HIVE', type: 'toggle' },
      { id: 'flower', label: 'Scores into FLOWER (top, 21.5 in)', type: 'toggle' },
      { id: 'garden', label: 'Scores into GARDEN', type: 'toggle' },
      { id: 'autoLeave', label: 'Auto: LEAVE', type: 'toggle' },
      { id: 'autoPieces', label: 'Auto: pieces scored (claimed)', type: 'number' },
      { id: 'autoTip', label: 'Auto: can complete a HIVE TIP', type: 'toggle' },
      { id: 'autoPark', label: 'Auto: PARK', type: 'toggle' },
      { id: 'autoStart', label: 'Preferred start position', type: 'select', options: ['Either', 'Near HIVE', 'Far side', 'Other'] },
      { id: 'tipsPerMatch', label: 'Teleop: HIVE TIPs per match (claimed)', type: 'number' },
      { id: 'cycle', label: 'Cycle time (s, claimed)', type: 'number' },
      { id: 'endPark', label: 'Endgame: PARK', type: 'toggle' },
      { id: 'endNectar', label: 'Endgame: NECTAR into FLOWER', type: 'toggle' },
      { id: 'vision', label: 'Uses vision / localization', type: 'toggle' },
      { id: 'lang', label: 'Programming', type: 'select', options: ['Java (Android Studio)', 'Blocks', 'OnBot Java', 'Kotlin', 'Other'] },
      { id: 'role', label: 'Preferred role', type: 'select', options: ['Scorer', 'Tipper', 'Flower/endgame', 'Defense', 'Flexible'] },
      { id: 'reliability', label: 'Robot confidence', type: 'rating' },
      { id: 'notes', label: 'Strategy / notes', type: 'text' },
    ],

    // Alliance ranking point thresholds shown on the analysis page.
    rankingPoints: {
      swarm: 'SWARM: alliance LEAVE + PARK points >= 16',
      pollinator: 'POLLINATOR: 4 and 7 HIVE TIPs',
    },
  },
};

export const DEFAULT_SEASON = '2627';

export function season(key) {
  return SEASONS[key] || SEASONS[DEFAULT_SEASON];
}
