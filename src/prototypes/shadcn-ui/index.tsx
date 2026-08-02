import React from 'react';

import { createRoot } from 'react-dom/client';

import { PrototypeApp } from './prototype-app';
import './prototype.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root mount point');
}

createRoot(root).render(
  <React.StrictMode>
    <PrototypeApp />
  </React.StrictMode>
);
