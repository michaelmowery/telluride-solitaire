// Telluride Seasons deck definition.
// Each suit is a season. Red/black colours stay standard so Klondike rules read naturally.

export const SUITS = [
  { key: 'S', name: 'Spades',   symbol: '♠', color: 'black', season: 'Winter' },
  { key: 'H', name: 'Hearts',   symbol: '♥', color: 'red',   season: 'Spring' },
  { key: 'D', name: 'Diamonds', symbol: '♦', color: 'red',   season: 'Summer' },
  { key: 'C', name: 'Clubs',    symbol: '♣', color: 'black', season: 'Fall' },
];

export const RANK_LABELS = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = [null, 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];

export const suitOf = (card) => SUITS[card.suit];
export const isRed = (card) => SUITS[card.suit].color === 'red';

/** File name of a card face in assets/cards, matching telluride.cards naming (AS.jpg, 10H.jpg, KD.jpg). */
export const cardCode = (card) => `${RANK_LABELS[card.rank]}${SUITS[card.suit].key}`;

export const cardName = (card) => `${RANK_NAMES[card.rank]} of ${SUITS[card.suit].name}`;

export function newDeck() {
  const cards = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      cards.push({ id: suit * 13 + rank - 1, suit, rank, faceUp: false });
    }
  }
  return cards;
}
