// Turns the black-background logo into a transparent 128px PNG: luminance < 24 -> clear, ramp to opaque at 48.
import sharp from "sharp";

const { data, info } = await sharp(".plans/wizard-revamp/logo-source.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  data[i + 3] = l < 24 ? 0 : l >= 48 ? 255 : Math.round(((l - 24) / 24) * 255);
}
await sharp(data, { raw: info }).trim().resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile("public/logo.png");
