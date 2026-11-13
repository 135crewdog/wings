// Fetches the island's land for the app: terrain/island.json, and the height
// map and country map it names. The one image serves twice: its pixels are read out as
// heights for the flight model, and the image itself goes to the picture.
// The loading is after 135crewdog/rage, src/main.js (loadTerrain).

import { decodeCanopy, decodeCountry, decodeHeights } from './sim/island.js';

// An image's pixels, as the page's 2D canvas reads them back.
async function pixelsOf(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  pen.drawImage(image, 0, 0);
  return { image, pixels: pen.getImageData(0, 0, image.width, image.height).data, count: image.width * image.height };
}

/** Resolves to { region, heights, canopy, country, image, countryImage }. */
export async function loadLand() {
  const region = await (await fetch('./terrain/island.json')).json();
  const [land, kinds] = await Promise.all([pixelsOf(`./terrain/${region.image}`), pixelsOf(`./terrain/${region.country}`)]);
  return {
    region, image: land.image, countryImage: kinds.image,
    heights: decodeHeights(land.pixels, land.count), canopy: decodeCanopy(land.pixels, land.count), country: decodeCountry(kinds.pixels, kinds.count),
  };
}
