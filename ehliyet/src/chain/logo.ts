// Avalanche işareti (kırmızı daire, beyaz "A"). 32 birimlik çizim; istenen boyuta ölçeklenir.
export const AVAX_RED = "#E84142";
export const AVAX_PATH =
  "M20.9 16.9c.5-.9 1.4-.9 1.9 0l3 5.3c.5.9.1 1.6-.9 1.6h-6.1c-1 0-1.4-.7-.9-1.6zM15.1 6.8c.5-.9 1.4-.9 1.9 0l.7 1.2 1.6 2.9c.4.8.4 1.8 0 2.6l-5.4 9.4c-.5.8-1.3 1.3-2.2 1.4H7.2c-1 0-1.4-.7-.9-1.6z";
export const avaxMark = (x: number, y: number, size: number) =>
  `<g transform="translate(${x} ${y}) scale(${size / 32})"><circle cx="16" cy="16" r="16" fill="${AVAX_RED}"/><path d="${AVAX_PATH}" fill="#fff"/></g>`;
