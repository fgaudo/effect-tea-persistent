# A seat, from the browser to the entity

The seat of the [quick start](../quick-start/README.md) with an interface. A screen in the browser shows a hold,
confirms it, and shows the seat released once the hold's timer fires. The screen is a program of
[effect-tea](https://github.com/fgaudo/effect-tea), and the hold is an entity on the server. Both import one module
of schemas, so a message the screen sends is one the entity reads. Run it with `bun examples/seat/serve.ts`, and
open `http://localhost:3000`.

The example makes three choices, each the smallest that works:

- **The screen follows the projection by reading it again.** The hold's projection is a subscription of the screen
  under the hold's id, which reads at once and then every second. The subscription stops while a message is under
  way and starts anew at its reply. So a reading begun before the reply is never shown after it.
- **The boundary is one contract, made from the program's schemas.** [`api.ts`](api.ts) declares an `HttpApi` of
  Effect with the hold's inbound message and its projection. The server implements the contract on the holds'
  handle, and the screen derives its client from the same value.
- **The code between the two lives in the application.** The library holds none of it. The contract, the boundary
  and the screen's command are files of the example.

A reply never says what the hold became. So after each reply the screen reads the projection again, and works out
nothing by itself. A confirmation with no reply yet is sent again under the same request id, for half a minute, and
the boundary keeps each reply for a minute.

- [`schemas.ts`](schemas.ts): the message and the projection, which both programs import.
- [`hold.ts`](hold.ts): the entity.
- [`api.ts`](api.ts): the contract between the screen and the boundary.
- [`boundary.ts`](boundary.ts): the contract implemented on the holds' handle.
- [`screen.ts`](screen.ts): the screen, a program of effect-tea.
- [`view.ts`](view.ts): the screen's view, as nodes of the DOM.
- [`page.ts`](page.ts): the script of [`index.html`](index.html), which runs the screen in the browser.
- [`serve.ts`](serve.ts): the process that launches the runtime and serves the page and the boundary.
- [`screen.test.ts`](screen.test.ts): the screen's rules, and the screen and the hold rehearsed together, with no
  browser, no server and no database to set up.
- [`http.test.ts`](http.test.ts): the whole flow over HTTP, on the launched runtime.
