# Shader effects (.gre + .frag)

Verified against https://friction.graphics/documentation/shaders.html, the examples in
`src/examples/shaderEffects/` and `AppSupport::getAppShaderPath()` in
`src/core/appsupport.cpp`. Shader effects are raster effects: they render in the viewer
and in video renders, but are **not** exported to SVG.

## Files and location

Two files sharing a base name: `myEffect.gre` (XML definition) + `myEffect.frag` (GLSL
fragment shader). Folder:

- Source default: `%LOCALAPPDATA%\friction\ShaderEffects` (setting `CustomShaderPath`,
  visible in Preferences > Shaders).
- Docs write `ShadersEffects` - trust the path shown in Preferences.
- Shader effects are disabled in GLES builds (`#ifndef USE_GLES` in main.cpp); normal
  desktop builds use OpenGL 3.3 core.

Upstream examples to copy from: eBrightnessContrast, eColorize, eColorize2, eDots,
eExplode, eMultiplyRed, eNoiseFade, eWipe, eWipeLeft, eWipeRight
(https://github.com/friction2d/friction/tree/main/src/examples/shaderEffects).

## .gre structure

```xml
<ShaderEffect name="Example Effect">          <!-- name shown in the UI -->
  <Properties>
    <Property name="amount" nameUI="amount" type="float"
              min="0" max="100" ini="8" step="1"
              glValue="true" resolutionScaled="true"/>
  </Properties>
  <Script>                                    <!-- optional, JavaScript -->
    <Definitions> function twice(x) { return 2*x; } </Definitions>
    <Calculate>
      var local = Math.PI * amount;
      extern doubled = twice(local);          <!-- extern = visible to glValues/Margin -->
    </Calculate>
  </Script>
  <glValues>                                  <!-- optional: computed uniforms -->
    <glValue name="uDoubled" type="float" value="doubled"/>
  </glValues>
  <Margin value="amount"/>                    <!-- optional: expand texture -->
</ShaderEffect>
```

Property attributes: `name` (required; identifier used in Script and as a uniform when
`glValue="true"`), `type` (required: `int`, `float`, `vec2`, `color`), `nameUI`,
`xnameUI`/`ynameUI` (vec2 component labels), `min` (0), `max` (100), `ini` (0), `step`
(1), `glValue` (false), `resolutionScaled` (false; docs: value is multiplied by the
scene resolution). vec2
values accept `[x, y]` or a single `x`. All properties are animatable.

Script: `Definitions` run once and cannot read properties; `Calculate` runs per call, can
read properties (vec2 as `[x, y]`) and `_eRect` (`[x, y, width, height]` of the object's
bounds before margin), and exports values with `extern`.

glValue `type`: float, vec2, vec3, vec4, int, ivec2, ivec3, ivec4; `value` is a JS
expression over properties/externs.

Margin: one value, `[h, v]`, or `[left, top, right, bottom]`.

## .frag skeleton

```glsl
#version 330 core
layout(location = 0) out vec4 fragColor;
in vec2 texCoord;              // from Friction's vertex shader
uniform sampler2D texture;     // object rendered to a texture by Friction
uniform float amount;          // Property with glValue="true"
uniform float uDoubled;        // glValue

void main(void) {
    vec4 color = texture2D(texture, texCoord);
    fragColor = vec4(color.rgb * (amount / 100.0), color.a);
}
```

`texture2D(texture, texCoord)` is what the upstream examples (e.g. eMultiplyRed.frag) use.
The effects loader watches the shader folder and loads newly added files; restart Friction
if an effect does not appear in the raster effects menu. Individual shaders can be
disabled in Preferences (setting `DisabledShaders`).
