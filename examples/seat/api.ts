/**
 * The contract between the screen and the boundary, declared once from the hold's schemas. The boundary implements
 * it on the holds' handle, and the screen derives its client from it, so a request the screen encodes is one the
 * boundary decodes.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import * as Schema from 'effect/Schema'
import { Confirm, Seat } from './schemas.ts'

/**
 * What a message is answered, as the runtime answers it. The library gives the type of an answer and no schema of
 * it, so the contract writes the schema. The boundary returns the runtime's answer as this schema's type, so an
 * answer the library adds fails to compile there. A hold gives no reason, so the reason of a rejection is null.
 */
export const Answer = Schema.Union([
  Schema.TaggedStruct('Accepted', {}),
  Schema.TaggedStruct('Rejected', { reason: Schema.Null }),
  Schema.TaggedStruct('NotFound', {}),
  Schema.TaggedStruct('Suspended', {}),
  Schema.TaggedStruct('Reused', {}),
])

/**
 * How long a caller may send a request again and be answered as the first time. The boundary keeps each reply that
 * long, and the screen stops sending a request again sooner.
 */
export const keep = { millis: 60_000 } as const

export const api = HttpApi.make('seat').add(
  HttpApiGroup.make('holds')
    // The hold's projection, or null where there is no such hold.
    .add(HttpApiEndpoint.get('read', '/holds/:id', { params: { id: Schema.String }, success: Schema.NullOr(Seat) }))
    // An inbound message, under the request id its caller chose.
    .add(HttpApiEndpoint.post('send', '/holds/:id/messages', {
      params: { id: Schema.String },
      payload: Schema.Struct({ requestId: Schema.String, message: Confirm }),
      success: Answer,
    })),
)
