// CloudFront Function (runtime cloudfront-js-2.0), viewer-request on the SPA
// distribution's default cache behaviour.
//
// The SPA uses BrowserRouter, so /notes, /chat and /notes/:id are client-side
// routes with no corresponding S3 object. The bucket is private behind OAC and
// the policy grants s3:GetObject only — with no s3:ListBucket, S3 answers a
// missing key with 403 AccessDenied rather than 404, which CloudFront would
// otherwise pass through to the browser as raw S3 error XML.
//
// Rewriting only extensionless paths — rather than mapping 403/404 to
// index.html via CustomErrorResponses — keeps genuine asset misses honest. A
// stale tab importing a hashed chunk that no longer exists gets a 403, not an
// HTML document that the browser then fails to parse as JavaScript.
//
// The top-level `handler` is required by the CloudFront Functions runtime
// contract; the repo's "no free functions" rule does not reach edge runtimes.
function handler(event) {
  var request = event.request;
  var last_segment = request.uri.substring(request.uri.lastIndexOf('/') + 1);

  // No dot in the final segment means a route, not a file: "/notes",
  // "/notes/abc123", "/chat/" all rewrite; "/assets/index-D4f2.js" does not.
  if (last_segment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
