# 使用官方 Node.js 22 轻量版镜像作为基础镜像
FROM node:22-alpine

# 设置工作目录为项目根目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装项目依赖。danmux 从 npm registry 安装，不依赖 git。
RUN npm install

# 复制所有源代码
COPY danmu_api/ ./danmu_api/
COPY config/ ./config_example/

# 自用版本号：发布流程以 build-arg 注入（形如 xdanmu-v0.60），运行时供页头「当前版本」使用。
# 放在依赖与源码之后，避免版本变化使上面的层缓存失效。
ARG XDANMU_VERSION=""
ENV XDANMU_VERSION=${XDANMU_VERSION}

# 暴露端口
EXPOSE 9321

# 启动命令
CMD ["node", "danmu_api/server.js"]
