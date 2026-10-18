import path from 'node:path';
import { app } from 'electron';
import { LocalAgentToolControl } from './LocalAgentToolControl';

export const localAgentToolControl = new LocalAgentToolControl(() => path.join(app.getPath('userData'), 'browser-tool-control.json'));
