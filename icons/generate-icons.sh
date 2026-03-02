#!/bin/bash
# Generate simple SVG icons for the extension
for size in 16 48 128; do
  cat > "/Users/sangdongmei/Working/translate/icons/icon${size}.svg" << EOF
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="$((size/8))" fill="#4a90d9"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="$((size*45/100))">Bi</text>
</svg>
EOF
done
echo "Icons generated"
