# 素材来源与许可

## 远山与云层全景

- 资源：`public/assets/open-hills-panorama-8k.webp`、`public/assets/open-hills-panorama-4k.webp`。
- 原作品：[Fouriesburg Mountain Midday](https://polyhaven.com/a/fouriesburg_mountain_midday)，Poly Haven。
- 作者：Dimitrios Savva（摄影）、Jarod Guest（处理）。
- 许可：[CC0](https://polyhaven.com/license)，原素材可以使用、修改和再分发，包含商业用途。
- 原始文件：[8K Tonemapped JPG（fouriesburg_mountain_midday.jpg）](https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/fouriesburg_mountain_midday.jpg)。
- 发布方文件元数据：[files/fouriesburg_mountain_midday](https://api.polyhaven.com/files/fouriesburg_mountain_midday)。
- 下载核验：37,287,009字节，MD5 `437721de5989343f50b7f9f93182e90f`。
- 处理：使用`cwebp -q 90 -m 6 -metadata icc`编码，保留ICC；8K保持原生8192×4096像素，4K增加`-resize 4096 2048`缩小为4096×2048。无生成式放大或额外合成。
- 用途：封闭天空球上的远山、蓝天与积云，以及河流和湖泊的环境反射。资源随仓库本地提供，运行时不请求Poly Haven。
- 视野：开阔远山与低植被，没有近景高树伸入天空；替换原先带有近景松树的Lago d’Isola全景。

## 生成素材

`pine-tree.png`、`grass-texture.jpg`、`weathered-rock.jpg`及docs内设计参考由内置Image Gen生成。源码采用仓库MIT许可；这些素材随项目提供。原始生成说明与视觉验证见[design.md](./design.md)。
