import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startExportView } from './ExportView';
import './styles.css';

if (location.hash === '#export') startExportView();
else createRoot(document.getElementById('root')!).render(<App />);
