// Load polyfill for :focus-visible pseudo-class.
import 'focus-visible';

// Enable debug checks for Preact. Removed in prod builds by Rollup config.
import 'preact/debug';

// Load icons.
import { registerIcons } from '@hypothesis/frontend-shared';
import { annotatorIcons } from './icons';
registerIcons(annotatorIcons);

import {
  PortProvider,
  installPortCloseWorkaroundForSafari,
} from '../shared/messaging';
import { getConfig } from './config/index';
import { Guest } from './guest';
import { HypothesisInjector } from './hypothesis-injector';
import {
  VitalSourceInjector,
  vitalSourceFrameRole,
} from './integrations/vitalsource';
import { Notebook } from './notebook';
import { Sidebar } from './sidebar';
import { EventBus } from './util/emitter';

import debounce from 'lodash.debounce';

/** @typedef {import('../types/annotator').Destroyable} Destroyable */

// Look up the URL of the sidebar. This element is added to the page by the
// boot script before the "annotator" bundle loads.
const sidebarLinkElement = /** @type {HTMLLinkElement} */ (
  document.querySelector(
    'link[type="application/annotator+html"][rel="sidebar"]'
  )
);

/**
 * @typedef {import('./components/NotebookModal').NotebookConfig} NotebookConfig
 * @typedef {import('./guest').GuestConfig} GuestConfig
 * @typedef {import('./hypothesis-injector').InjectConfig} InjectConfig
 * @typedef {import('./sidebar').SidebarConfig} SidebarConfig
 * @typedef {import('./sidebar').SidebarContainerConfig} SidebarContainerConfig
 */

/**
 * Entry point for the part of the Hypothesis client that runs in the page being
 * annotated.
 *
 * Depending on the client configuration in the current frame, this can
 * initialize different functionality. In "host" frames the sidebar controls and
 * iframe containing the sidebar application are created. In "guest" frames the
 * functionality to support anchoring and creating annotations is loaded. An
 * instance of Hypothesis will have one host frame, one sidebar frame and one or
 * more guest frames. The most common case is that the host frame, where the
 * client is initially loaded, is also the only guest frame.
 */
function init() {
  const annotatorConfig = /** @type {GuestConfig & InjectConfig} */ (
    getConfig('annotator')
  );

  const hostFrame = annotatorConfig.subFrameIdentifier ? window.parent : window;

  /** @type {Destroyable[]} */
  const destroyables = [];

  if (hostFrame === window) {
    // Ensure port "close" notifications from eg. guest frames are delivered properly.
    const removeWorkaround = installPortCloseWorkaroundForSafari();
    destroyables.push({ destroy: removeWorkaround });

    const sidebarConfig = /** @type {SidebarConfig} */ (getConfig('sidebar'));

    const hypothesisAppsOrigin = new URL(sidebarConfig.sidebarAppUrl).origin;
    const portProvider = new PortProvider(hypothesisAppsOrigin);

    const eventBus = new EventBus();
    const sidebar = new Sidebar(document.body, eventBus, sidebarConfig);
    const notebook = new Notebook(
      document.body,
      eventBus,
      /** @type {NotebookConfig} */ (getConfig('notebook'))
    );

    portProvider.on('frameConnected', (source, port) =>
      sidebar.onFrameConnected(source, port)
    );
    destroyables.push(portProvider, sidebar, notebook);
  }

  const vsFrameRole = vitalSourceFrameRole();

  console.info('vsFrameRole: ' + vsFrameRole);

  if (vsFrameRole === 'container') {
    const vitalSourceInjector = new VitalSourceInjector(annotatorConfig);
    destroyables.push(vitalSourceInjector);
  } else {
    // Set up automatic injection of the client into iframes in this frame.
    const hypothesisInjector = new HypothesisInjector(
      document.body,
      annotatorConfig
    );
    // Create the guest that handles creating annotations and displaying highlights.
    const guest = new Guest(document.body, annotatorConfig, hostFrame);
    destroyables.push(hypothesisInjector, guest);

    // // method to check if element is in view
    // const isInViewport = function(/** @type {{ getBoundingClientRect: () => any; }} */ element) {
    //   const rect = element.getBoundingClientRect();
    //   return (
    //       rect.top >= 0 &&
    //       rect.left >= 0 &&
    //       rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    //       rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    //   );
    // }

    const getCells = () => {
      return document.getElementsByClassName("jp-Cell");
      // return document.body.getElementsByTagName("*");
    }
    
    // called when user scrolls the page
    const handleScroll = () => {

      let scrollHeight = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight,
        document.body.clientHeight, document.documentElement.clientHeight
      );

      let relScroll = window.scrollY / scrollHeight;
  
      // console.info(document.body.scrollHeight, document.documentElement.scrollHeight,
      //   document.body.offsetHeight, document.documentElement.offsetHeight,
      //   document.body.clientHeight, document.documentElement.clientHeight);
      
      console.info('height: ' + scrollHeight + ', scrollY: ' + window.scrollY 
      + ', rel: ' + window.scrollY / scrollHeight);

      guest._updateScrollPositionRel(relScroll);

      // var a = document.body.scrollTop;
      // var b = document.body.scrollHeight - document.body.clientHeight;
      // var c = a / b;

      // console.info("document.body.scrollTop ", document.body.scrollTop);
      // console.info("document.body.offsetHeight ", document.body.offsetHeight);
      // console.info("pct", document.body.scrollTop/document.body.offsetHeight);
      // console.info("c", a, b, c);
  
      // const elements = getCells()
      // const length = elements.length;
  
      // var i = 1;
      // for (const elem of elements) {
      //   const inView = isInViewport(elem);
      //   if (inView) {
      //     console.info("first cell in view", i, "/", elements.length);
      //     var a = elem.scrollTop;
      //     var b = elem.scrollHeight - elem.clientHeight;
      //     var c = a / b;
      //     console.info("a, b, c", a, b, c);

      //     guest._updateScrollPosition(i);
      //     break;
      //   }
      //   i++;
      // }
    };
  
    guest._initYjs(getCells(), document, window);
    window.addEventListener("scroll", debounce(handleScroll, 100));

  }

  sidebarLinkElement.addEventListener('destroy', () => {
    destroyables.forEach(instance => instance.destroy());

    // Remove all the `<link>`, `<script>` and `<style>` elements added to the
    // page by the boot script.
    const clientAssets = document.querySelectorAll('[data-hypothesis-asset]');
    clientAssets.forEach(el => el.remove());
  });
}

/**
 * Returns a Promise that resolves when the document has loaded (but subresources
 * may still be loading).
 *
 * @return {Promise<void>}
 */
function documentReady() {
  return new Promise(resolve => {
    if (document.readyState !== 'loading') {
      resolve();
    }
    // nb. `readystatechange` may be emitted twice, but `resolve` only resolves
    // on the first call.
    document.addEventListener('readystatechange', () => resolve());
  });
}

documentReady().then(init);
