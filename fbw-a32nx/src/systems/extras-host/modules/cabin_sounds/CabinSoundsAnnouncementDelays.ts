// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { Instrument, SimVarValueType } from '@microsoft/msfs-sdk';

interface DelayedAnnouncement {
  /** LVar starting the announcement in sound.xml */
  readonly lvar: string;
  readonly delaySeconds: number;
  /** The condition that used to start the announcement right away */
  readonly isTriggered: () => boolean;
  /** Sim time at which the condition became true, null while it is false */
  triggeredSince: number | null;
}

const isBeaconOn = (): boolean => SimVar.GetSimVarValue('LIGHT BEACON', SimVarValueType.Bool);

// after the flight (DONE phase), the slides are disarmed when the beacon is turned off or a door is opened
const areSlidesDisarmedAfterFlight = (): boolean =>
  SimVar.GetSimVarValue('L:A32NX_FMGC_FLIGHT_PHASE', SimVarValueType.Number) >= 7 &&
  !SimVar.GetSimVarValue('L:A32NX_SLIDES_ARMED', SimVarValueType.Bool);

/**
 * Delays the cabin announcements: arm doors 20 s after the beacon is turned on, then the safety demo 3 min 20 s after,
 * and disarm doors 20 s after the slides are disarmed at the end of the flight. Each announcement is driven in sound.xml
 * by its own LVar, set once its condition has been true for its delay in sim time and reset as soon as it is false.
 */
export class CabinSoundsAnnouncementDelays implements Instrument {
  private readonly announcements: DelayedAnnouncement[] = [
    { lvar: 'L:A32NX_SOUND_ARM_DOORS_DUE', delaySeconds: 20, isTriggered: isBeaconOn, triggeredSince: null },
    // the safety demo sound itself starts 30 s after being triggered, so it plays 3 min 20 s after the beacon
    { lvar: 'L:A32NX_SOUND_SAFETY_DEMO_DUE', delaySeconds: 170, isTriggered: isBeaconOn, triggeredSince: null },
    {
      lvar: 'L:A32NX_SOUND_DISARM_DOORS_DUE',
      delaySeconds: 20,
      isTriggered: areSlidesDisarmedAfterFlight,
      triggeredSince: null,
    },
  ];

  private readonly written = new Map<string, number>();

  public init(): void {
    // nothing to set up, the LVars are written on the first update
  }

  public onUpdate(): void {
    const simTime = SimVar.GetSimVarValue('E:SIMULATION TIME', SimVarValueType.Seconds);

    for (const announcement of this.announcements) {
      if (!announcement.isTriggered()) {
        announcement.triggeredSince = null;
      } else if (announcement.triggeredSince === null) {
        announcement.triggeredSince = simTime;
      }

      const value =
        announcement.triggeredSince !== null && simTime - announcement.triggeredSince >= announcement.delaySeconds
          ? 1
          : 0;

      if (this.written.get(announcement.lvar) !== value) {
        this.written.set(announcement.lvar, value);
        SimVar.SetSimVarValue(announcement.lvar, SimVarValueType.Number, value);
      }
    }
  }
}
