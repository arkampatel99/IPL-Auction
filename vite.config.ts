import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The player database is big on its own; keep it, React and PeerJS in separate cacheable files.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('players.json')) return 'players';
          if (id.includes('node_modules/peerjs')) return 'peer';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});
