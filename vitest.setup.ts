/**
 * jsdom does not implement HTMLCanvasElement.getContext. Returning a throwing
 * stub lets the detector code catch the exception cleanly without jsdom's
 * default "Not implemented" console spam.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function () {
    throw new Error('canvas not supported in this environment');
  };
}
