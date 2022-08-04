import 'source-map-support/register';
import {app, BrowserWindow, Menu, Tray, shell, ipcMain, dialog, desktopCapturer} from 'electron';
import path from 'path';
import util from 'util';
import Bridge from './bridge';
import fs from 'fs/promises';
import fsPlain from 'fs';
import Updater from './updater';
import OscConnection from "./OscConnection";
import Buttplug from "./Buttplug";
import OscConfigDeleter from "./OscConfigDeleter";

process.on("uncaughtException", (err) => {
  dialog.showErrorBox("Fatal Error", err.stack+'');
  app.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error('Unhandled rejection', err);
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit();
}

const updater = new Updater();
updater.checkAndNotify();

const savePath = path.join(app.getPath('appData'), 'OscGoesBrrr', 'config.txt');
const configMap = new Map<string,string>();
let configTxt = '';

let oscConnection: OscConnection | undefined;

function loadConfig(txt: string) {
  configTxt = txt;
  const oldConfigMap = new Map<string,string>(configMap);
  configMap.clear();
  for (let line of configTxt.split('\n')) {
    line = line.trim();
    if (line.startsWith('/') || line.startsWith('#')) continue;
    const split = line.split('=', 2);
    const key = split[0]!.trim();
    if (!key) continue;
    const value = (split.length > 1 ? split[1]! : '').trim();
    configMap.set(key, value);
  }

  if (oldConfigMap.get('osc.port') !== configMap.get('osc.port')) {
    if (oscConnection) oscConnection.delayRetry();
  }
}

if (fsPlain.existsSync(savePath)) {
  loadConfig(fsPlain.readFileSync(savePath, {encoding: 'utf-8'}));
}

let mainWindow: BrowserWindow | undefined;
function createWindow() {
  if (mainWindow != null) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'app/preload.js')
    }
  })
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('app/index.html');
  mainWindow.setIcon(path.join(app.getAppPath(), 'app/tps-bio.png'));
  mainWindow.setTitle('OSC Goes Brrr v' + updater.getLocalVersion());
  mainWindow.on('closed', () => mainWindow = undefined);
  mainWindow.on('page-title-updated', e => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', createWindow);
})

function sendLog(type: string, ...args: unknown[]) {
  console.log(`[${type}]`, ...args);
  if (mainWindow) {
    mainWindow.webContents.send(type, util.format(...args));
  }
}

//app.on('window-all-closed', e => e.preventDefault());

app.on('second-instance', createWindow);

/*
let tray = null
app.whenReady().then(() => {
  tray = new Tray(path.join(app.getAppPath(), 'tps-bio.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Exit', click: async () => { app.quit() } },
  ])
  tray.setToolTip('OSC Goes Brrr');
  tray.setContextMenu(contextMenu);
  tray.on('click', createWindow);
})
 */

const buttLogger = (...args: unknown[]) => sendLog('bioLog', ...args);
const oscLogger = (...args: unknown[]) => sendLog('oscLog', ...args);
const butt = new Buttplug(buttLogger);
oscConnection = new OscConnection(oscLogger, configMap);
const bridge = new Bridge(oscConnection, butt, buttLogger, configMap);
new OscConfigDeleter(oscLogger, configMap);

setInterval(() => {
  if (!mainWindow) return;

  const globalSources = bridge.getGlobalSources(true);

  let oscStatus = '';
  if (!oscConnection || !oscConnection.socketopen) {
    oscStatus = `OSC socket isn't open.\nIs something else using the OSC port?`;
  } else if (!oscConnection.lastReceiveTime || oscConnection.lastReceiveTime < Date.now() - 60_000) {
    oscStatus = `Haven't received OSC status recently.\nIs game open and active?\nIs OSC Enabled in the radial menu?`;
  } else {
    const gameDeviceStatuses = Array.from(bridge.getGameDevices())
        .map(d => d.getStatus());
    gameDeviceStatuses.sort();

    const globalSourcesLines = globalSources
        .map(source => source.deviceType+'.'+source.deviceName+'.'+source.featureName+'='+source.value);
    globalSourcesLines.sort();

    const rawOscParams = Array.from(oscConnection.entries())
        .map(([k,v]) => `${k}=${v.get()}`);
    rawOscParams.sort();

    const status = gameDeviceStatuses.join('\n')+'\n\n'+globalSourcesLines.join('\n')+'\n\n'+rawOscParams.join('\n');
    oscStatus = status;
  }
  mainWindow.webContents.send('oscStatus', oscStatus);

  let bioStatus = '';
  if (butt.wsReady()) {
    const devices = Array.from(bridge.getToys()).map(toy => toy.getStatus());
    devices.sort();
    let devicesStr;
    if (devices.length) {
      devicesStr = devices.join('\n');
    } else {
      devicesStr = 'None';
    }
    bioStatus = 'Connected to Intiface!\nConnected Devices:\n' + devicesStr;
  } else {
    bioStatus = 'Not connected to Intiface.\nIs Intiface Desktop running?\nDid you click Start Server?';
  }

  mainWindow.webContents.send('bioStatus', bioStatus);
}, 100);

ipcMain.handle('config:save', (_event, text) => {
  loadConfig(text);

  fs.mkdir(path.dirname(savePath), {recursive: true}).then(() => fs.writeFile(savePath, text));
  if (mainWindow) mainWindow.webContents.send('config:saved');
});
ipcMain.handle('config:load', (_event) => {
  return configTxt;
});

ipcMain.handle('fft:status', (_event, level) => {
  if (typeof level != 'number') return;
  if (level < 0 || level > 1 || isNaN(level)) return;
  bridge.receivedFft(level);
})

setInterval(() => {
  if(!mainWindow) return;
  const audioLevel = parseFloat(configMap.get('audio') ?? '');
  const on = !isNaN(audioLevel) && audioLevel > 0;
  mainWindow.webContents.send(on ? 'fft:start' : 'fft:stop');
}, 1000);
