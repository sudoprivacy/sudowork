import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Avatar root element not found');
}
const root = createRoot(container);
root.render(React.createElement(App));
