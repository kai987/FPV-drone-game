# 素材来源与许可

## 远山与云层全景

- 资源：`public/assets/alpine-panorama-hd.webp`（7096×3548，3,285,114字节）、`public/assets/alpine-panorama-mobile.webp`（3548×1774，1,276,646字节）。
- 来源：按照用户提供的雪峰、松林山谷、蓝天白云参考图，使用内置Image Gen生成。原始生成图实际为1774×887；提示词中的目标尺寸没有由工具原生实现。
- 增强：使用[Real-ESRGAN-ncnn-vulkan v0.2.0官方macOS工具](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/tag/v0.2.0)和[Real-ESRGAN v0.2.5.0官方模型包](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0)内的`realesrgan-x4plus`通用图像模型，4倍超分得到7096×3548；不属于原生7K/8K素材。
- 软件许可：[ncnn工具MIT](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/blob/v0.2.0/LICENSE)、[Real-ESRGAN项目BSD-3-Clause](https://github.com/xinntao/Real-ESRGAN/blob/v0.2.5.0/LICENSE)。官方模型文档未单列权重许可。仓库只包含处理后的图像，不再分发工具或模型；不把软件许可或CC0摄影许可标注为生成图的许可。
- 原始生成图SHA256：`05377ee3aadc0c5c411179d3167a1c8a8e1fbff0501510178f873c4c4b817147`。
- 超分PNG的SHA256：`e05ab4a5a58a2d946c5f718dc54f50aa15a9d2bf50f827e2668bae28e8b39314`。
- 高清WebP的SHA256：`6868c02d66208f7d48b38d9ed493d5424b0941ff774024c881b7ca086a8dbe60`；手机WebP的SHA256：`9fd4d3a196bd6d54274123c87f4219f5ea0831bbf527580b7586e1547c58a17c`。
- 编码：`cwebp -q 90 -m 6`；手机版增加`-resize 3548 1774`。超分时保留构图与2:1比例，没有裁切、扩图或手工重绘。
- 用途：封闭天空球上的远山、蓝天与白云，以及河流和湖泊的环境反射。资源随仓库本地提供，运行时不请求生成或超分服务。
- 视野：远处森林位于地平线下方，通过共用的雾化范围遮去，地图上的树林由原有三维模型显示。天空球随相机移动，避免靠近背景产生尺寸变化。
- 接缝：生成图的左右云形并非逐像素连续，运行时在水平两端各1.5%的范围使用平滑混合，天空与水面采用同一采样函数；源图构图保持不变。

超分命令（工具、模型和原始PNG在仓库外保存；文件名按本地路径替换）：

```sh
realesrgan-ncnn-vulkan -i alpine-panorama-generated.png \
  -o alpine-panorama-realesrgan-4x.png -m models \
  -n realesrgan-x4plus -s 4 -t 256 -j 1:1:1 -f png
cwebp -q 90 -m 6 alpine-panorama-realesrgan-4x.png -o alpine-panorama-hd.webp
cwebp -q 90 -m 6 -resize 3548 1774 alpine-panorama-realesrgan-4x.png -o alpine-panorama-mobile.webp
```

### 内置Image Gen提示词

参考图的作用是风格与风景参考；透明背景关闭，使用内置工具模式，没有使用OpenAI CLI/API生成。

```text
Use case: stylized-concept. Asset type: high resolution distant alpine sky panorama for a Three.js FPV flight game. Input image is a STYLE and LANDSCAPE reference, not an immutable-size edit target. Create a NEW, genuinely higher resolution image, target native output 3840 x 1920 pixels (2:1) or the highest available native 2:1 resolution. Regenerate fine details instead of merely resizing the 2172x724 reference. Preserve its beautiful crisp photorealistic game-art appearance: a majestic continuous chain of jagged grey Alpine rock mountains with patches of bright white snow, distant green conifer valleys, rich clear blue daytime sky and delicate scattered white clouds. Keep detailed rocky strata, believable erosion, natural snow edges and crisp cloud wisps, no blurry painterly smudges or excessive sharpening halos. Make it a full 360x180 equirectangular environment image, 2:1 aspect, seamless left and right edges. Horizon at exactly the vertical midpoint, mountain peaks rise about 15 to 25 degrees above it, smaller distant forest just around or BELOW the horizon. All trees MUST be tiny distant forest texture: absolutely no near foreground trees, branches, buildings, poles or giant shrub silhouettes. Upper half should show sky and snowy distant mountain silhouettes, top edge should be continuous blue zenith without mountains, no gap at top. Lower half can extend distant natural terrain, but no close ground objects. Preserve the bright green / slate grey / white snow / blue sky palette and general mountain silhouette style of the reference. No text, logo, drone or UI. Output must be the newly generated higher pixel resolution environment, not the input image returned at its original 2172x724 dimensions.
```

## 生成素材

`pine-tree.png`、`grass-texture.jpg`、`weathered-rock.jpg`及docs内设计参考由内置Image Gen生成。源码采用仓库MIT许可；这些素材随项目提供。原始生成说明与视觉验证见[design.md](./design.md)。
