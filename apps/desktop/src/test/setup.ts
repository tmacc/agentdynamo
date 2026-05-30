import { vi } from "vitest";

const appListeners = new Map<string, Set<(...args: readonly unknown[]) => void>>();
const nativeThemeListeners = new Map<string, Set<(...args: readonly unknown[]) => void>>();
const allWindows: MockBrowserWindow[] = [];

class MockBrowserWindow {
  readonly webContents = {
    copyImageAt: vi.fn(),
    isLoadingMainFrame: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    openDevTools: vi.fn(),
    replaceMisspelling: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  private destroyed = false;
  private minimized = false;
  private visible = true;

  constructor(_options?: unknown) {
    allWindows.push(this);
  }

  static getAllWindows() {
    return allWindows.filter((window) => !window.isDestroyed());
  }

  static getFocusedWindow() {
    return MockBrowserWindow.getAllWindows()[0] ?? null;
  }

  destroy() {
    this.destroyed = true;
  }

  focus() {}

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return this.minimized;
  }

  isVisible() {
    return this.visible;
  }

  loadFile = vi.fn(() => Promise.resolve());
  loadURL = vi.fn(() => Promise.resolve());
  on = vi.fn();
  once = vi.fn();

  restore() {
    this.minimized = false;
  }

  setBackgroundColor = vi.fn();
  setTitle = vi.fn();
  setTitleBarOverlay = vi.fn();

  show() {
    this.visible = true;
  }
}

const addListener = (
  listeners: Map<string, Set<(...args: readonly unknown[]) => void>>,
  eventName: string,
  listener: (...args: readonly unknown[]) => void,
) => {
  const eventListeners =
    listeners.get(eventName) ?? new Set<(...args: readonly unknown[]) => void>();
  eventListeners.add(listener);
  listeners.set(eventName, eventListeners);
};

const removeListener = (
  listeners: Map<string, Set<(...args: readonly unknown[]) => void>>,
  eventName: string,
  listener: (...args: readonly unknown[]) => void,
) => {
  listeners.get(eventName)?.delete(listener);
};

vi.mock("electron", () => ({
  app: {
    commandLine: {
      appendSwitch: vi.fn(),
    },
    dock: {
      setIcon: vi.fn(),
    },
    exit: vi.fn(),
    focus: vi.fn(),
    getAppPath: vi.fn(() => "/app"),
    getPath: vi.fn(() => "/tmp"),
    getVersion: vi.fn(() => "0.0.0-test"),
    isPackaged: false,
    name: "Dynamo",
    on: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      addListener(appListeners, eventName, listener);
    }),
    quit: vi.fn(),
    relaunch: vi.fn(),
    removeListener: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      removeListener(appListeners, eventName, listener);
    }),
    runningUnderARM64Translation: false,
    setAboutPanelOptions: vi.fn(),
    setAppUserModelId: vi.fn(),
    setDesktopName: vi.fn(),
    setName: vi.fn(),
    setPath: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  },
  BrowserWindow: MockBrowserWindow,
  clipboard: {
    writeText: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })),
    showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({
      popup: vi.fn(),
    })),
    setApplicationMenu: vi.fn(),
  },
  nativeImage: {
    createFromNamedImage: vi.fn(() => ({})),
    createFromPath: vi.fn(() => ({})),
  },
  nativeTheme: {
    on: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      addListener(nativeThemeListeners, eventName, listener);
    }),
    removeListener: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      removeListener(nativeThemeListeners, eventName, listener);
    }),
    shouldUseDarkColors: false,
    themeSource: "system",
  },
  protocol: {
    registerFileProtocol: vi.fn(() => true),
    registerSchemesAsPrivileged: vi.fn(),
    unregisterProtocol: vi.fn(() => true),
  },
  safeStorage: {
    decryptString: vi.fn((value: Buffer) => value.toString("utf8")),
    encryptString: vi.fn((value: string) => Buffer.from(value, "utf8")),
    isEncryptionAvailable: vi.fn(() => true),
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1280, height: 800 } })),
  },
  shell: {
    openExternal: vi.fn(() => Promise.resolve()),
  },
}));
