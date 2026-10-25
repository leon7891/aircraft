// Copyright (c) 2021-2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { GameStateProvider, Instrument, Wait } from '@microsoft/msfs-sdk';
import { NXUnits, UpdateThrottler } from '@flybywiresim/fbw-sdk';

const WING_FUELRATE_GAL_SEC = 4.01;
const CENTER_MODIFIER = 0.4528;
// a tank within this margin of its target counts as at it, so a quantity the sim may read back a hair off the value
// written neither moves the tank again nor holds the refuel
const TARGET_TOLERANCE_GAL = 0.01;
enum RefuelRateNumeric {
  REAL = 0,
  FAST = 1,
  INSTANT = 2,
}

const isAboveTarget = (current: number, target: number) => current > target + TARGET_TOLERANCE_GAL;
const isBelowTarget = (current: number, target: number) => current < target - TARGET_TOLERANCE_GAL;
const isAtTarget = (current: number, target: number) => Math.abs(current - target) <= TARGET_TOLERANCE_GAL;

/**
 * Moves the fuel towards the targets set on the flyPad fuel page. It runs here rather than in the MCDU because MSFS 2024
 * stops updating the cockpit screens while the user walks around as an avatar: the refuel would freeze there, and GSX,
 * which only watches the fuel quantity, would send its truck away long before the end.
 */
export class Refuel implements Instrument {
  private readonly throttler = new UpdateThrottler(150);

  private lastUpdateTime = 0;

  private isInit = false;

  public init(): void {
    // the targets are synced with the tanks once the flight is loaded
    Wait.awaitSubscribable(GameStateProvider.get(), (state) => state === GameState.ingame, true).then(() => {
      this.initTargets();
      this.lastUpdateTime = Date.now();
      this.isInit = true;
    });
  }

  public onUpdate(): void {
    if (!this.isInit) {
      return;
    }

    const now = Date.now();
    const deltaTime = this.throttler.canUpdate(now - this.lastUpdateTime);
    this.lastUpdateTime = now;

    if (deltaTime !== -1) {
      this.update(deltaTime);
    }
  }

  private initTargets(): void {
    const totalFuelGallons = 6267;
    const fuelWeight = SimVar.GetSimVarValue('FUEL WEIGHT PER GALLON', 'kilograms');
    const centerCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK CENTER QUANTITY', 'Gallons');
    const LInnCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK LEFT MAIN QUANTITY', 'Gallons');
    const LOutCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK LEFT AUX QUANTITY', 'Gallons');
    const RInnCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK RIGHT MAIN QUANTITY', 'Gallons');
    const ROutCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK RIGHT AUX QUANTITY', 'Gallons');
    const total = Math.round(
      Math.max(LInnCurrentSimVar + LOutCurrentSimVar + RInnCurrentSimVar + ROutCurrentSimVar + centerCurrentSimVar, 0),
    );
    const totalConverted = Math.round(NXUnits.kgToUser(total * fuelWeight));
    SimVar.SetSimVarValue('L:A32NX_REFUEL_STARTED_BY_USR', 'Bool', false);
    SimVar.SetSimVarValue('L:A32NX_FUEL_TOTAL_DESIRED', 'Number', total);
    SimVar.SetSimVarValue('L:A32NX_FUEL_DESIRED', 'Number', totalConverted); // TODO this looks sus... should not be user units in simvars
    SimVar.SetSimVarValue('L:A32NX_FUEL_DESIRED_PERCENT', 'Number', Math.round((total / totalFuelGallons) * 100));
    SimVar.SetSimVarValue('L:A32NX_FUEL_CENTER_DESIRED', 'Number', centerCurrentSimVar);
    SimVar.SetSimVarValue('L:A32NX_FUEL_LEFT_MAIN_DESIRED', 'Number', LInnCurrentSimVar);
    SimVar.SetSimVarValue('L:A32NX_FUEL_LEFT_AUX_DESIRED', 'Number', LOutCurrentSimVar);
    SimVar.SetSimVarValue('L:A32NX_FUEL_RIGHT_MAIN_DESIRED', 'Number', RInnCurrentSimVar);
    SimVar.SetSimVarValue('L:A32NX_FUEL_RIGHT_AUX_DESIRED', 'Number', ROutCurrentSimVar);
  }

  /**
   * Lowers a tank towards its target and returns its quantity. A tank below its target is left to the refuel steps:
   * setting it to the target in one go would be a jump that the FADEC undoes as a change from the fuel menu.
   */
  private defuelTank(simVar: string, current: number, target: number, step: number): number {
    if (!isAboveTarget(current, target)) {
      return current;
    }
    const quantity = Math.max(current - step, target);
    SimVar.SetSimVarValue(simVar, 'Gallons', quantity);
    return quantity;
  }

  /** Raises a tank towards its target and returns its quantity. A tank above its target is left to the defuel steps. */
  private refuelTank(simVar: string, current: number, target: number, step: number): number {
    if (!isBelowTarget(current, target)) {
      return current;
    }
    const quantity = Math.min(current + step, target);
    SimVar.SetSimVarValue(simVar, 'Gallons', quantity);
    return quantity;
  }

  private update(deltaTime: number) {
    const refuelStartedByUser = SimVar.GetSimVarValue('L:A32NX_REFUEL_STARTED_BY_USR', 'Bool');
    if (!refuelStartedByUser) {
      return;
    }
    const busDC2 = SimVar.GetSimVarValue('L:A32NX_ELEC_DC_2_BUS_IS_POWERED', 'Bool');
    const busDCHot1 = SimVar.GetSimVarValue('L:A32NX_ELEC_DC_HOT_1_BUS_IS_POWERED', 'Bool');
    const gs = SimVar.GetSimVarValue('GPS GROUND SPEED', 'knots');
    const onGround = SimVar.GetSimVarValue('SIM ON GROUND', 'Bool');
    const eng1Running = SimVar.GetSimVarValue('ENG COMBUSTION:1', 'Bool');
    const eng2Running = SimVar.GetSimVarValue('ENG COMBUSTION:2', 'Bool');
    const refuelRate = SimVar.GetSimVarValue('L:A32NX_EFB_REFUEL_RATE_SETTING', 'number');
    if (refuelRate !== RefuelRateNumeric.INSTANT) {
      if (!onGround || eng1Running || eng2Running || gs > 0.1 || (!busDC2 && !busDCHot1)) {
        return;
      }
    }
    const centerTargetSimVar = SimVar.GetSimVarValue('L:A32NX_FUEL_CENTER_DESIRED', 'Number');
    const LInnTargetSimVar = SimVar.GetSimVarValue('L:A32NX_FUEL_LEFT_MAIN_DESIRED', 'Number');
    const LOutTargetSimVar = SimVar.GetSimVarValue('L:A32NX_FUEL_LEFT_AUX_DESIRED', 'Number');
    const RInnTargetSimVar = SimVar.GetSimVarValue('L:A32NX_FUEL_RIGHT_MAIN_DESIRED', 'Number');
    const ROutTargetSimVar = SimVar.GetSimVarValue('L:A32NX_FUEL_RIGHT_AUX_DESIRED', 'Number');
    const centerCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK CENTER QUANTITY', 'Gallons');
    const LInnCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK LEFT MAIN QUANTITY', 'Gallons');
    const LOutCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK LEFT AUX QUANTITY', 'Gallons');
    const RInnCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK RIGHT MAIN QUANTITY', 'Gallons');
    const ROutCurrentSimVar = SimVar.GetSimVarValue('FUEL TANK RIGHT AUX QUANTITY', 'Gallons');
    let centerCurrent = centerCurrentSimVar;
    let LInnCurrent = LInnCurrentSimVar;
    let LOutCurrent = LOutCurrentSimVar;
    let RInnCurrent = RInnCurrentSimVar;
    let ROutCurrent = ROutCurrentSimVar;
    const centerTarget = centerTargetSimVar;
    const LInnTarget = LInnTargetSimVar;
    const LOutTarget = LOutTargetSimVar;
    const RInnTarget = RInnTargetSimVar;
    const ROutTarget = ROutTargetSimVar;
    if (refuelRate === RefuelRateNumeric.INSTANT) {
      SimVar.SetSimVarValue('FUEL TANK CENTER QUANTITY', 'Gallons', centerTarget);
      SimVar.SetSimVarValue('FUEL TANK LEFT MAIN QUANTITY', 'Gallons', LInnTarget);
      SimVar.SetSimVarValue('FUEL TANK LEFT AUX QUANTITY', 'Gallons', LOutTarget);
      SimVar.SetSimVarValue('FUEL TANK RIGHT MAIN QUANTITY', 'Gallons', RInnTarget);
      SimVar.SetSimVarValue('FUEL TANK RIGHT AUX QUANTITY', 'Gallons', ROutTarget);
    } else {
      let multiplier = 1;
      if (refuelRate === RefuelRateNumeric.FAST) {
        multiplier = 5;
      }
      multiplier *= deltaTime / 1000;
      const centerStep = WING_FUELRATE_GAL_SEC * multiplier * CENTER_MODIFIER;
      // the two tanks of a pair share the wing rate
      const wingStep = (WING_FUELRATE_GAL_SEC * multiplier) / 2;
      //DEFUELING (center tank first, then main, then aux)
      centerCurrent = this.defuelTank('FUEL TANK CENTER QUANTITY', centerCurrent, centerTarget, centerStep);
      LInnCurrent = this.defuelTank('FUEL TANK LEFT MAIN QUANTITY', LInnCurrent, LInnTarget, wingStep);
      RInnCurrent = this.defuelTank('FUEL TANK RIGHT MAIN QUANTITY', RInnCurrent, RInnTarget, wingStep);
      if (isAboveTarget(LInnCurrent, LInnTarget) || isAboveTarget(RInnCurrent, RInnTarget)) {
        return;
      }
      LOutCurrent = this.defuelTank('FUEL TANK LEFT AUX QUANTITY', LOutCurrent, LOutTarget, wingStep);
      ROutCurrent = this.defuelTank('FUEL TANK RIGHT AUX QUANTITY', ROutCurrent, ROutTarget, wingStep);
      if (isAboveTarget(LOutCurrent, LOutTarget) || isAboveTarget(ROutCurrent, ROutTarget)) {
        return;
      }
      // REFUELING (aux first, then main, then center tank)
      centerCurrent = this.refuelTank('FUEL TANK CENTER QUANTITY', centerCurrent, centerTarget, centerStep);
      LOutCurrent = this.refuelTank('FUEL TANK LEFT AUX QUANTITY', LOutCurrent, LOutTarget, wingStep);
      ROutCurrent = this.refuelTank('FUEL TANK RIGHT AUX QUANTITY', ROutCurrent, ROutTarget, wingStep);
      if (isBelowTarget(LOutCurrent, LOutTarget) || isBelowTarget(ROutCurrent, ROutTarget)) {
        return;
      }
      LInnCurrent = this.refuelTank('FUEL TANK LEFT MAIN QUANTITY', LInnCurrent, LInnTarget, wingStep);
      RInnCurrent = this.refuelTank('FUEL TANK RIGHT MAIN QUANTITY', RInnCurrent, RInnTarget, wingStep);
      if (isBelowTarget(LInnCurrent, LInnTarget) || isBelowTarget(RInnCurrent, RInnTarget)) {
        return;
      }
    }

    if (
      isAtTarget(centerCurrent, centerTarget) &&
      isAtTarget(LInnCurrent, LInnTarget) &&
      isAtTarget(LOutCurrent, LOutTarget) &&
      isAtTarget(RInnCurrent, RInnTarget) &&
      isAtTarget(ROutCurrent, ROutTarget)
    ) {
      // DONE FUELING
      SimVar.SetSimVarValue('L:A32NX_REFUEL_STARTED_BY_USR', 'Bool', false);
    }
  }
}
