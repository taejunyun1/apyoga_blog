import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const iconSource = fileURLToPath(new URL("../public/app-icon.svg", import.meta.url))
const iconDirectory = fileURLToPath(new URL("../public/icons/", import.meta.url))

await mkdir(iconDirectory, { recursive: true })

for (const size of [180, 192, 512]) {
  await sharp(iconSource)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`../public/icons/app-icon-${size}.png`, import.meta.url)))
}

console.log("Generated PWA icons: 180, 192, 512")
