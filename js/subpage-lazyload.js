(function () {
  const INITIAL_RENDER_COUNT = 24;
  const RENDER_BATCH_SIZE = 18;
  const ASSET_META = window.__GALLERY_ASSET_META__ || {};
  const pageKey = Object.keys(ASSET_META).find(function (key) {
    return window.location.pathname.replace(/\\/g, "/").includes("/" + key + "/");
  });
  const pageMeta = (pageKey && ASSET_META[pageKey]) || {};

  function normalizeAssetPath(value) {
    return String(value || "").replace(/\\/g, "/");
  }

  function getAssetInfo(source) {
    return pageMeta[source] || null;
  }

  function makePlaceholder(width, height) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      width +
      '" height="' +
      height +
      '" viewBox="0 0 ' +
      width +
      " " +
      height +
      '"></svg>';
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function prepareImage(img) {
    if (img.dataset.lazyPrepared === "1") return;

    const originalSrc = img.getAttribute("src") || "";
    const info = getAssetInfo(originalSrc);
    if (!info || info.type !== "image") {
      if (originalSrc) img.dataset.lazySrc = originalSrc;
      img.dataset.lazyPrepared = "1";
      return;
    }

    img.dataset.lazySrc = normalizeAssetPath(info.thumb);
    img.dataset.fullSrc = normalizeAssetPath(info.src);
    img.setAttribute("width", String(info.width));
    img.setAttribute("height", String(info.height));
    img.setAttribute("src", makePlaceholder(info.width, info.height));
    img.removeAttribute("srcset");
    img.dataset.lazyPrepared = "1";
  }

  function prepareVideo(video) {
    if (video.dataset.lazyPrepared === "1") return;

    const originalSrc =
      video.dataset.gallerySrc || video.getAttribute("src") || "";
    const info = getAssetInfo(originalSrc);
    if (info && info.type === "video") {
      video.dataset.lazyVideoSrc = normalizeAssetPath(info.src);
      video.dataset.lazyPoster = normalizeAssetPath(info.poster);
      if (!video.hasAttribute("width")) video.setAttribute("width", String(info.width));
      if (!video.hasAttribute("height")) video.setAttribute("height", String(info.height));
    } else if (originalSrc) {
      video.dataset.lazyVideoSrc = originalSrc;
    }

    video.removeAttribute("src");
    video.setAttribute("preload", "none");
    video.setAttribute("playsinline", "");
    video.dataset.lazyPrepared = "1";
  }

  function prepareWithin(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(".aigc-item img")) prepareImage(root);
    if (root.matches(".aigc-item video")) prepareVideo(root);
    root.querySelectorAll(".aigc-item img").forEach(prepareImage);
    root.querySelectorAll(".aigc-item video").forEach(prepareVideo);
  }

  function observeParsedGalleryItems() {
    if (document.readyState !== "loading") {
      prepareWithin(document.documentElement);
      return;
    }

    const observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(prepareWithin);
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener(
      "DOMContentLoaded",
      function () {
        observer.disconnect();
        prepareWithin(document.documentElement);
      },
      { once: true }
    );
  }

  function optimizeOffscreenRendering() {
    document.querySelectorAll(".aigc-grid .aigc-item").forEach(function (item) {
      item.style.contentVisibility = "auto";
      item.style.containIntrinsicSize = "1200px 675px";
    });
  }

  function setLazyLoadingForImages() {
    const images = Array.from(document.querySelectorAll(".aigc-grid .aigc-item img"));

    images.forEach(function (img) {
      prepareImage(img);
      if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
      if (!img.hasAttribute("decoding")) img.setAttribute("decoding", "async");

      const item = img.closest(".aigc-item");
      const grid = img.closest(".aigc-grid");
      const index = grid && item ? Array.from(grid.children).indexOf(item) : 999;
      img.setAttribute("fetchpriority", index < 3 ? "high" : "low");
    });

    if (!("IntersectionObserver" in window)) {
      images.forEach(function (img) {
        if (img.dataset.lazySrc) img.setAttribute("src", img.dataset.lazySrc);
      });
      return;
    }

    const imageObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          if (img.dataset.lazySrc) img.setAttribute("src", img.dataset.lazySrc);
          observer.unobserve(img);
        });
      },
      { rootMargin: "400px 0px", threshold: 0.01 }
    );

    images.forEach(function (img) {
      if (img.dataset.lazyObserved === "1") return;
      imageObserver.observe(img);
      img.dataset.lazyObserved = "1";
    });
  }

  function setLazyLoadingForVideos() {
    const videos = Array.from(document.querySelectorAll(".aigc-grid .aigc-item video"));

    videos.forEach(function (video) {
      prepareVideo(video);
      video.setAttribute("preload", "none");
      video.setAttribute("playsinline", "");
    });

    if (!("IntersectionObserver" in window)) {
      videos.forEach(function (video) {
        if (!video.getAttribute("src") && video.dataset.lazyVideoSrc) {
          if (video.dataset.lazyPoster) video.setAttribute("poster", video.dataset.lazyPoster);
          video.setAttribute("src", video.dataset.lazyVideoSrc);
          video.load();
        }
      });
      return;
    }

    const videoObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          const video = entry.target;
          if (!video.getAttribute("src") && video.dataset.lazyVideoSrc) {
            if (video.dataset.lazyPoster) video.setAttribute("poster", video.dataset.lazyPoster);
            video.setAttribute("src", video.dataset.lazyVideoSrc);
            video.load();
            if (video.hasAttribute("autoplay")) {
              const play = function () {
                const promise = video.play();
                if (promise && promise.catch) promise.catch(function () {});
              };
              video.addEventListener("canplay", play, { once: true });
            }
          }
          observer.unobserve(video);
        });
      },
      { rootMargin: "300px 0px", threshold: 0.01 }
    );

    videos.forEach(function (video) {
      if (video.dataset.lazyObserved === "1") return;
      videoObserver.observe(video);
      video.dataset.lazyObserved = "1";
    });
  }

  function enableProgressiveGalleryRendering() {
    const grid = document.getElementById("gallery-grid");
    if (!grid) return;

    const items = Array.from(grid.children).filter(function (item) {
      return item.classList && item.classList.contains("aigc-item");
    });
    if (items.length <= INITIAL_RENDER_COUNT) return;

    const pendingItems = items.slice(INITIAL_RENDER_COUNT);
    pendingItems.forEach(function (item) {
      item.remove();
    });

    if (!("IntersectionObserver" in window)) {
      const fragment = document.createDocumentFragment();
      pendingItems.forEach(function (item) {
        fragment.appendChild(item);
      });
      grid.appendChild(fragment);
      return;
    }

    const sentinel = document.createElement("li");
    sentinel.className = "lazy-load-sentinel";
    sentinel.style.height = "1px";
    sentinel.style.listStyle = "none";
    grid.appendChild(sentinel);

    const appendBatch = function () {
      const batch = pendingItems.splice(0, RENDER_BATCH_SIZE);
      if (batch.length === 0) {
        sentinel.remove();
        return;
      }

      const fragment = document.createDocumentFragment();
      batch.forEach(function (item) {
        fragment.appendChild(item);
      });
      grid.insertBefore(fragment, sentinel);

      optimizeOffscreenRendering();
      setLazyLoadingForImages();
      setLazyLoadingForVideos();
    };

    appendBatch();

    const loadObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          appendBatch();
          if (pendingItems.length === 0) loadObserver.disconnect();
        });
      },
      { rootMargin: "600px 0px", threshold: 0 }
    );

    loadObserver.observe(sentinel);
  }

  observeParsedGalleryItems();

  window.initSubpageLazyLoading = function initSubpageLazyLoading() {
    enableProgressiveGalleryRendering();
    optimizeOffscreenRendering();
    setLazyLoadingForImages();
    setLazyLoadingForVideos();
  };
})();
