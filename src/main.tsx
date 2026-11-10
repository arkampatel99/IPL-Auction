import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import Home from './screens/Home';
import BotSetup from './screens/BotSetup';
import Game from './screens/Game';
import Songs from './screens/Songs';
import { loadSongs } from './ui/songStore';
import { loadPhotos } from './ui/photoStore';
import Photos from './screens/Photos';
import { Privacy, Terms } from './screens/Legal';
import NotFound from './screens/NotFound';
import PageMeta from './ui/PageMeta';
import Friends, { HostLobby } from './screens/Friends';
import GuestGame from './screens/GuestGame';
import { isAdmin } from './ui/admin';
import UpdateBanner from './ui/UpdateBanner';

void loadSongs();
void loadPhotos();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PageMeta />
      <UpdateBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/bots" element={<BotSetup />} />
        <Route path="/game" element={<Game />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/room" element={<HostLobby />} />
        <Route path="/r/:code" element={<GuestGame />} />
        {isAdmin && <Route path="/songs" element={<Songs />} />}
        {isAdmin && <Route path="/photos" element={<Photos />} />}
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
