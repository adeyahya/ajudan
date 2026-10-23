// Bridge for the web app: switch the window to a business (it keeps running in the
// background after you switch away), stop one, or show the list.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ajudan", {
  app: true,
  openFolder: (dir) => ipcRenderer.invoke("ajudan:open-folder", dir),
  stopFolder: (dir) => ipcRenderer.invoke("ajudan:stop-folder", dir),
  showHome: () => ipcRenderer.invoke("ajudan:show-home"),
  pickFolder: () => ipcRenderer.invoke("ajudan:pick-folder"),
});
