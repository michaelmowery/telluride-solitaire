# Telluride Solitaire

Klondike solitaire played with the **Telluride Seasons** photo deck ([telluride.cards](https://www.telluride.cards)), for **play.telluride.cards**.

Each suit is a season: ♠ Winter · ♥ Spring · ♦ Summer · ♣ Fall.

## Run it

It's a static site with no build step.

```sh
npm start          # or: python3 -m http.server 8080
open http://localhost:8080
npm test           # rules-engine tests (Node 18+)
```

## Card art

Put one image per card in `assets/cards/` (`AS.jpg`, `10H.jpg`, `KD.jpg`, …, plus `back.jpg`). See `assets/cards/README.md`.
Any card without an image is drawn as a styled season card, so the game works before the art is added.

`./scripts/fetch-cards.sh` pulls the web-sized photos from telluride.cards as a starting point. Full-resolution exports look better.

## Features

- Draw 1 or draw 3, unlimited redeals
- Drag and drop, or tap a card to send it to the best spot
- Undo, hints, auto-finish once everything is face up
- Numbered deals (`#deal=1234`) so a deal can be shared or replayed
- Saves the game in progress and win stats in the browser
- Works on phones (touch) and desktop (mouse; keys: `U` undo, `H` hint, `N` new, `Space` draw)

## Layout

```
index.html, styles.css
js/deck.js   suits, seasons, card names and image codes
js/game.js   Klondike rules (pure functions, tested in tests/)
js/ui.js     rendering, drag and drop, timer, win screen
```

## Deploy

Copy the repo contents (everything except `tests/` and `scripts/`) to any static host and point `play.telluride.cards` at it.
