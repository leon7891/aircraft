// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { Instrument, SimVarValueType } from '@microsoft/msfs-sdk';

/**
 * Silences the cabin sounds (passenger ambience, announcements, boarding music) while the user walks around as an
 * avatar, which MSFS 2024 does not treat as an exterior view. The flyPad audio toggles are mirrored into the LVars
 * driving the Wwise volume RTPCs, forced to 0 in avatar mode: the sounds keep playing muted instead of being stopped,
 * so they don't restart when the user comes back to the aircraft.
 */
export class CabinSoundsAvatarMute implements Instrument {
  private static readonly TOGGLES: readonly [setting: string, audible: string][] = [
    ['L:A32NX_SOUND_PASSENGER_AMBIENCE_ENABLED', 'L:A32NX_SOUND_PASSENGER_AMBIENCE_AUDIBLE'],
    ['L:A32NX_SOUND_ANNOUNCEMENTS_ENABLED', 'L:A32NX_SOUND_ANNOUNCEMENTS_AUDIBLE'],
    ['L:A32NX_SOUND_BOARDING_MUSIC_ENABLED', 'L:A32NX_SOUND_BOARDING_MUSIC_AUDIBLE'],
  ];

  private readonly written = new Map<string, number>();

  public init(): void {
    // nothing to set up, the LVars are written on the first update
  }

  public onUpdate(): void {
    // environment variable: without the E: prefix it is read on the aircraft, which never reports the avatar mode
    const isAvatar = SimVar.GetSimVarValue('E:IS AVATAR', SimVarValueType.Bool);

    for (const [setting, audible] of CabinSoundsAvatarMute.TOGGLES) {
      const value = isAvatar ? 0 : SimVar.GetSimVarValue(setting, SimVarValueType.Number);

      if (this.written.get(audible) !== value) {
        this.written.set(audible, value);
        SimVar.SetSimVarValue(audible, SimVarValueType.Number, value);
      }
    }
  }
}
