//  Copyright (c) 2026 FlyByWire Simulations
//  SPDX-License-Identifier: GPL-3.0

import { describe, expect, it } from 'vitest';
import { INavlogFix } from '@flybywiresim/fbw-sdk';
import { SimBriefConnector } from './SimBriefConnector';

const WIND_LEVELS = [0, 5000, 10000, 14000, 18000, 24000, 30000, 34000, 39000, 45000];

function navlogFix(ident: string, type: string, stage: string, altitude: number): INavlogFix {
  return {
    ident,
    type,
    stage,
    altitude_feet: altitude.toString(),
    wind_data: {
      level: WIND_LEVELS.map((level) => ({
        altitude: level.toString(),
        wind_dir: level === 0 ? '43' : '200',
        wind_spd: level === 0 ? '4' : '20',
        oat: '0',
      })),
    },
  } as INavlogFix;
}

function parseDescentWinds(navlog: INavlogFix[]) {
  return SimBriefConnector['parseDescentWinds'](navlog, { descentWindLevel: 330 }) ?? [];
}

describe('SimBriefConnector descent winds', () => {
  it('adds the surface wind of the destination as GRND wind', () => {
    const winds = parseDescentWinds([
      navlogFix('ENGM', 'apt', 'CLB', 700),
      navlogFix('TOD', 'ltlg', 'CRZ', 33000),
      navlogFix('OBCIV', 'wpt', 'DSC', 6400),
      navlogFix('ESSA', 'apt', 'DSC', 2600),
    ]);

    expect(winds[winds.length - 2].flightLevel).toBe(50);
    expect(winds[winds.length - 1]).toEqual({ flightLevel: 0, trueDegrees: 43, magnitude: 4 });
  });

  it('does not add the surface wind twice', () => {
    const winds = parseDescentWinds([
      navlogFix('ENGM', 'apt', 'CLB', 700),
      navlogFix('TOD', 'ltlg', 'CRZ', 33000),
      navlogFix('ESSA', 'apt', 'DSC', 2400),
    ]);

    expect(winds.filter((wind) => wind.flightLevel === 0)).toHaveLength(1);
  });
});
