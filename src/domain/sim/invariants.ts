/** Must hold for any run under any algorithm, so a dispatcher bug fails loudly. */

import type { PassengerStream } from '../traffic/PassengerStream';
import type { SimResult } from './types';

export function checkInvariants(stream: PassengerStream, result: SimResult): string[] {
  const problems: string[] = [];

  if (result.journeys.length !== stream.passengers.length) {
    problems.push(
      `${stream.passengers.length} people asked for a lift but ${result.journeys.length} ` +
        'journeys came back. Nobody may be lost.',
    );
  }

  const byId = new Map(stream.passengers.map((passenger) => [passenger.id, passenger]));

  for (const journey of result.journeys) {
    const passenger = byId.get(journey.passengerId);
    if (!passenger) {
      problems.push(`Journey ${journey.passengerId} belongs to no passenger in the stream.`);
      continue;
    }

    if (journey.origin !== passenger.origin || journey.destination !== passenger.destination) {
      problems.push(
        `Passenger ${journey.passengerId} wanted ${passenger.origin} → ${passenger.destination} ` +
          `but the journey says ${journey.origin} → ${journey.destination}.`,
      );
    }

    if (journey.calledAt !== passenger.arrivalTime) {
      problems.push(
        `Passenger ${journey.passengerId} called at a different time than they arrived.`,
      );
    }

    if (journey.boardedAt !== null && journey.boardedAt < journey.calledAt) {
      problems.push(`Passenger ${journey.passengerId} boarded before pressing the button.`);
    }

    if (journey.arrivedAt !== null) {
      if (journey.boardedAt === null) {
        problems.push(`Passenger ${journey.passengerId} arrived without ever boarding.`);
      } else if (journey.arrivedAt < journey.boardedAt) {
        problems.push(`Passenger ${journey.passengerId} arrived before boarding.`);
      }
    }

    if (journey.leftBehind < 0) {
      problems.push(`Passenger ${journey.passengerId} was left behind a negative number of times.`);
    }
  }

  const unfinished = result.journeys.filter((journey) => journey.arrivedAt === null).length;
  if (unfinished !== result.unfinished) {
    problems.push(
      `The result says ${result.unfinished} unfinished journeys but ${unfinished} have no ` +
        'arrival time.',
    );
  }

  if (result.carDistance < 0) problems.push('Cars travelled a negative distance.');
  if (result.carStarts < 0) problems.push('Cars set off a negative number of times.');
  if (result.carStarts === 0 && result.journeys.length > 0 && unfinished < result.journeys.length) {
    problems.push('Somebody was carried without any car ever setting off.');
  }

  return problems;
}

/** Waiting time in seconds, or null for somebody who never got in. */
export function waitOf(journey: SimResult['journeys'][number]): number | null {
  return journey.boardedAt === null ? null : journey.boardedAt - journey.calledAt;
}

/** Time from pressing the button to stepping out, or null if they never arrived. */
export function timeToDestinationOf(journey: SimResult['journeys'][number]): number | null {
  return journey.arrivedAt === null ? null : journey.arrivedAt - journey.calledAt;
}
