FROM node:18

# Instal mesin pengonversi dokumen (LibreOffice) dan grafis (Ghostscript)
RUN apt-get update && \
    apt-get install -y libreoffice graphicsmagick ghostscript && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]