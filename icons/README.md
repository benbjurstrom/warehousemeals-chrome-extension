# Extension Icons

Place PNG icons in this directory:

- `icon16.png` - 16x16px (toolbar)
- `icon32.png` - 32x32px (Windows)
- `icon48.png` - 48x48px (extensions page)
- `icon128.png` - 128x128px (Chrome Web Store)

## Generating Icons

You can generate icons from the SVG logo using ImageMagick:

```bash
# From the chrome directory
for size in 16 32 48 128; do
  convert -background none -resize ${size}x${size} logo.svg icons/icon${size}.png
done
```

Or use an online tool like https://realfavicongenerator.net/

## Temporary Development Icons

For development, you can use simple colored squares. The extension will work without proper icons, just showing a default puzzle piece icon.
