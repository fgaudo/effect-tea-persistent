/**
 * The boundary of the holds: the contract of `api.ts`, implemented on the holds' handle. It authenticates nobody,
 * since a hold takes no sender.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { HttpApiBuilder } from 'effect/http-api'
import type { Handle, TypesOf } from '@fgaudo/effect-tea-persistent'
import { api, keep } from './api.ts'
import type { hold } from './hold.ts'

/** The two calls of the holds' handle that the boundary makes. */
export class Holds
  extends Context.Service<Holds, Pick<Handle<TypesOf<typeof hold>>, 'read' | 'send'>>()('examples/seat/Holds')
{}

export const boundary = HttpApiBuilder.group(
  api,
  'holds',
  Effect.fnUntraced(function*(handlers) {
    const holds = yield* Holds
    return handlers.handleAll({
      read: ({ params }) => holds.read(params.id),
      // The runtime's answer is the contract's, tag for tag, so the boundary maps nothing.
      send: ({ params, payload }) =>
        holds.send(params.id, payload.message, { requestId: payload.requestId, keep }),
    })
  }),
)
