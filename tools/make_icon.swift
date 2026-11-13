// Draws the app icon (original artwork: concentric ripples on a night gradient).
//   swift tools/make_icon.swift App/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png
import AppKit
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
let cs = CGColorSpaceCreateDeviceRGB()
let bg = CGGradient(colorsSpace: cs, colors: [CGColor(red: 0.16, green: 0.20, blue: 0.45, alpha: 1), CGColor(red: 0.05, green: 0.07, blue: 0.13, alpha: 1)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: 1024), end: CGPoint(x: 0, y: 0), options: [])
let c = CGPoint(x: 512, y: 512)
for (i, r) in [130.0, 215, 300, 385].enumerated() {
    ctx.setStrokeColor(CGColor(red: 0.62, green: 0.68, blue: 1.0, alpha: 0.95 - Double(i) * 0.22))
    ctx.setLineWidth(26 - CGFloat(i) * 4)
    ctx.strokeEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
}
ctx.setFillColor(CGColor(red: 0.93, green: 0.94, blue: 1.0, alpha: 1))
ctx.fillEllipse(in: CGRect(x: c.x - 52, y: c.y - 52, width: 104, height: 104))
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
