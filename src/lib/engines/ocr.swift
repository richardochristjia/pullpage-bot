import Vision
import AppKit

guard CommandLine.arguments.count > 1,
      let img = NSImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load image\n".data(using: .utf8)!)
  exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
for o in req.results ?? [] {
  if let c = o.topCandidates(1).first, c.confidence > 0.5 { print(c.string) }
}
