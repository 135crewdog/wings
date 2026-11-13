// Fetches the island's land for the app: terrain/island.json, and the height
// map it names. The one image serves twice: its pixels are read out as
// heights for the flight model, and the image itself goes to the picture.
// The loading is after 135crewdog/rage, src/main.js (loadTerrain).

import { decodeHeights } from './sim/island.js';

/** Resolves to { region, heights, image }. */
export async function loadLand() {
  const region = await (await fetch('./terrain/island.json')).json();
  const image = new Image();
  image.src = `./terrain/${region.image}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  pen.drawImage(image, 0, 0);
  const heights = decodeHeights(pen.getImageData(0, 0, image.width, image.height).data, image.width * image.height);
  return { region, heights, image };
}
