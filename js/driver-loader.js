// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Load pinned Driver.js assets from the CDN, with a vendored offline fallback.
(function loadDriverAssets() {
  const version = '1.8.0';
  const timeoutMilliseconds = 5000;
  const sources = {
    cdn: {
      css: `https://cdn.jsdelivr.net/npm/driver.js@${version}/dist/driver.css`,
      cssIntegrity: 'sha384-XUGWln86d3kDvw/W1Qbii8QQyeWs2LcFYfGhYrmSZ0ZiXxowttKpfdhPdLE+WMFx',
      script: `https://cdn.jsdelivr.net/npm/driver.js@${version}/dist/driver.js.iife.js`,
      scriptIntegrity: 'sha384-ZD4UAn12lO2plEJ4lonOHO0fRSCgq0VAuoDx6/rglijDjzDYIXgCexIVu3PFJpJf',
    },
    local: {
      css: `vendor/driver.js/${version}/driver.css`,
      script: `vendor/driver.js/${version}/driver.js.iife.js`,
    },
  };

  function removeAsset(id) {
    document.getElementById(id)?.remove();
  }

  function appendAsset(kind, url, id, integrity) {
    return new Promise((resolve, reject) => {
      const element = document.createElement(kind === 'css' ? 'link' : 'script');
      element.id = id;
      if (kind === 'css') {
        element.rel = 'stylesheet';
        element.href = url;
      } else {
        element.src = url;
      }
      if (integrity) {
        element.integrity = integrity;
        element.crossOrigin = 'anonymous';
      }

      const finish = (error) => {
        clearTimeout(timer);
        element.onload = null;
        element.onerror = null;
        if (error) {
          element.remove();
          reject(error);
        } else {
          resolve(element);
        }
      };
      const timer = setTimeout(
        () => finish(new Error(`Timed out loading ${url}`)),
        timeoutMilliseconds,
      );
      element.onload = () => finish();
      element.onerror = () => finish(new Error(`Unable to load ${url}`));
      document.head.append(element);
    });
  }

  async function loadSource(sourceName) {
    const source = sources[sourceName];
    const cssId = 'arbdraw-driver-css';
    const scriptId = 'arbdraw-driver-script';
    removeAsset(cssId);
    removeAsset(scriptId);
    try {
      await appendAsset('css', source.css, cssId, source.cssIntegrity);
      await appendAsset('script', source.script, scriptId, source.scriptIntegrity);
      const driverFactory = globalThis.driver?.js?.driver;
      if (typeof driverFactory !== 'function') {
        throw new Error(`Driver.js ${version} loaded without exposing its browser API.`);
      }
      globalThis.ARBDRAW_DRIVER_SOURCE = sourceName;
      return driverFactory;
    } catch (error) {
      removeAsset(cssId);
      removeAsset(scriptId);
      throw error;
    }
  }

  async function selectSource() {
    const preference = new URLSearchParams(globalThis.location?.search || '').get('driver');
    if (preference === 'local') return loadSource('local');
    try {
      return await loadSource('cdn');
    } catch (error) {
      console.warn('Unable to load Driver.js from the CDN; using the local copy.', error);
      return loadSource('local');
    }
  }

  globalThis.ARBDRAW_DRIVER_VERSION = version;
  globalThis.ARBDRAW_DRIVER_READY = selectSource();
})();
