/// <reference lib="dom" />
/**
 * The view of the screen, as nodes of the DOM. It draws the model's case and decides nothing: the one button it
 * draws sends the message the model holds.
 */
import type { View } from '@fgaudo/effect-tea'
import * as Effect from 'effect/Effect'
import type { Message, Model } from './screen.ts'

const sentences: Readonly<Record<Exclude<Model['_tag'], 'Held'>, string>> = {
  Reading: 'Reading the seat…',
  Missing: 'Nobody holds this seat.',
  Confirming: 'Confirming…',
  Confirmed: 'The seat is confirmed.',
  Released: 'The time ran out, and the seat was released.',
}

export const view: View<Model, Message, Node> = (model, dispatch) => {
  const line = document.createElement('p')
  if (model._tag !== 'Held') {
    line.textContent = sentences[model._tag]
    return line
  }
  const confirm = document.createElement('button')
  confirm.textContent = 'Confirm'
  confirm.addEventListener('click', () => Effect.runSync(dispatch(model.confirm)))
  line.append('The seat is held for a quarter of an hour. ', confirm)
  return line
}
