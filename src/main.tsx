import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicShare from './PublicShare';
import './styles.css';
const shared=window.location.pathname.startsWith('/s/');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{shared?<PublicShare id={window.location.pathname.split('/')[2]||''}/>:<App/>}</React.StrictMode>);
