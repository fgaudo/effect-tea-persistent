/**
 * The schemas of a hold that cross the network: the message a caller sends it, and what a caller reads of it. The
 * entity on the server and the screen in the browser both import this module, so the two cannot drift apart. It
 * imports `effect/Schema` alone, so a browser loads none of the entity's code with it.
 */
import * as Schema from 'effect/Schema'

/** The message a caller sends a hold. */
export const Confirm = Schema.TaggedStruct('Confirm', {})

/** What a caller reads of a hold, which is the hold's projection. */
export const Seat = Schema.Struct({ status: Schema.Literals(['Held', 'Confirmed', 'Released']) })

export type Seat = typeof Seat.Type
