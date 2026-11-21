import React, { useState, useEffect } from 'react';
import './styles/theme.css';
import { ToastProvider, useToast } from './context/ToastContext';
import { ConfirmDialogProvider, useConfirm } from './context/ConfirmDialogContext';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { StatsGrid } from './components/layout/StatsGrid';
import { VideoGallery } from './components/dashboard/VideoGallery';
import { ProductsTable } from './components/products/ProductsTable';
import { ProductModal } from './components/products/ProductModal';
import { CrawlModal } from './components/crawler/CrawlModal';
import { CharacterModal } from './components/character/CharacterModal';
import { ConcatModal } from './components/concat/ConcatModal';
import { VideoPlayerModal } from './components/video/VideoPlayerModal';
import { GenerateVideoModal } from './components/modals/GenerateVideoModal';
import { Lightbox } from './components/common/Lightbox';
import { ShortsStudioSection } from './components/shorts/ShortsStudioSection';
import { Product, VideoItem } from './types';

export const AppContent: React.FC = () => {
  const { showToast } = useToast();
  const { confirmDialog } = useConfirm();
  const [activeSection, setActiveSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Stats
  const [totalVideos, setTotalVideos] = useState<number | string>('—');
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineLastRun, setPipelineLastRun] = useState('');
  const [totalProducts, setTotalProducts] = useState<number | string>('—');
  const [totalTiktok, setTotalTiktok] = useState<number | string>('—');

  // Video Gallery
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotalPages, setVideoTotalPages] = useState(1);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [videoFormatTab, setVideoFormatTab] = useState<'short' | 'long'>('short');

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productPage, setProductPage] = useState(1);
  const [productTotalPages, setProductTotalPages] = useState(1);
  const [isProductLoading, setIsProductLoading] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);

  // Modals
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generateProduct, setGenerateProduct] = useState<Product | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isCrawlModalOpen, setIsCrawlModalOpen] = useState(false);
  const [isCharacterModalOpen, setIsCharacterModalOpen] = useState(false);
  const [isConcatModalOpen, setIsConcatModalOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<{ id: string; message: string; time: string; type: string }[]>([
    { id: '1', message: 'Hệ thống Studio React đã sẵn sàng', time: 'Vừa xong', type: 'info' },
  ]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'running' = 'info') => {
    setLogs((prev) => [
      { id: Math.random().toString(36).substring(2, 9), message, time: new Date().toLocaleTimeString('vi-VN'), type },
      ...prev,
    ]);
  };

  // Fetch videos
  const loadVideos = async (page = videoPage, fmt = videoFormatTab) => {
    setIsVideoLoading(true);
    try {
      const res = await fetch(`/api/videos?page=${page}&limit=20&format=${encodeURIComponent(fmt)}`);
      const resData = await res.json();
      const videoList = resData.data || resData.videos || [];
      if (Array.isArray(videoList)) {
        setVideos(videoList);
        setVideoPage(resData.page || page);
        setVideoTotalPages(resData.totalPages || Math.ceil((resData.total || videoList.length) / 20) || 1);
        setTotalVideos(resData.total !== undefined ? resData.total : videoList.length);
        const tiktokCount = videoList.filter((v: any) => v.tiktok_video_id || v.tiktok_status === 'published' || v.tiktok_status === 'mock').length;
        setTotalTiktok(tiktokCount);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsVideoLoading(false);
    }
  };

  // Fetch products
  const loadProducts = async (page = productPage) => {
    setIsProductLoading(true);
    try {
      const res = await fetch(`/api/products?page=${page}&limit=20`);
      const resData = await res.json();
      const productList = resData.data || resData.products || [];
      if (Array.isArray(productList)) {
        const sorted = [...productList].sort((a, b) => {
          const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tB - tA;
        });
        setProducts(sorted);
        setProductPage(resData.page || page);
        setProductTotalPages(resData.totalPages || Math.ceil((resData.total || productList.length) / 20) || 1);
        setTotalProducts(resData.total !== undefined ? resData.total : productList.length);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsProductLoading(false);
    }
  };

  // Fetch pipeline status
  const loadPipelineStatus = async () => {
    try {
      const res = await fetch('/api/pipeline/status');
      const data = await res.json();
      setPipelineRunning(Boolean(data.is_running));
      setPipelineLastRun(data.is_running ? 'Running...' : `Last: ${data.last_run_results?.length || 0} jobs`);
    } catch {}
  };

  useEffect(() => {
    loadVideos(1);
    loadProducts(1);
    loadPipelineStatus();
    const interval = setInterval(loadPipelineStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteVideo = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Xóa Video',
      message: 'Bạn có chắc chắn muốn xóa video này? Toàn bộ file video và dữ liệu phân cảnh sẽ bị xóa vĩnh viễn.',
      confirmText: 'Xóa Video',
      cancelText: 'Giữ lại',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('🗑️ Đã xóa video thành công!');
        loadVideos(videoPage);
      }
    } catch (e: any) {
      showToast('❌ Lỗi xóa video: ' + e.message);
    }
  };

  const handlePublishVideo = async (id: string) => {
    try {
      showToast('📱 Đang đăng video lên TikTok...');
      const res = await fetch(`/api/videos/${id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ ${data.message || 'Đăng TikTok thành công!'}`);
        loadVideos(videoPage);
      }
    } catch (e: any) {
      showToast('❌ Lỗi: ' + e.message);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Xóa Sản Phẩm',
      message: 'Bạn có chắc chắn muốn xóa sản phẩm này khỏi danh sách quản lý?',
      confirmText: 'Xóa Sản Phẩm',
      cancelText: 'Hủy bỏ',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('🗑️ Đã xóa sản phẩm!');
        loadProducts(productPage);
      }
    } catch (e: any) {
      showToast('❌ Lỗi: ' + e.message);
    }
  };

  const handleDryRun = async () => {
    try {
      showToast('🧪 Đang chạy kiểm thử Dry Run...');
      addLog('Bắt đầu chạy thử nghiệm Dry Run...', 'running');
      const res = await fetch('/api/test?dry_run=true');
      const data = await res.json();
      if (data.success) {
        showToast('✅ Dry run thành công!');
        addLog('Kiểm thử Dry Run thành công!', 'success');
      } else {
        showToast('❌ Dry run thất bại');
        addLog('Dry Run thất bại', 'error');
      }
    } catch (e: any) {
      showToast('❌ Lỗi: ' + e.message);
    }
  };

  return (
    <>
      <Navbar
        onOpenGenerateModal={() => {
          setGenerateProduct(null);
          setIsGenerateModalOpen(true);
        }}
        onOpenCharacterModal={() => setIsCharacterModalOpen(true)}
        onOpenConcatModal={() => setIsConcatModalOpen(true)}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
      />

      <div className="layout">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={(sec) => setActiveSection(sec)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onTriggerDryRun={handleDryRun}
        />

        <main>
          {activeSection === 'shorts-studio' ? (
            <>
              <div className="page-header">
                <h1>🎬 Shorts Studio (AI · 9:16)</h1>
                <p>Sáng tác kịch bản, đọc giọng AI & render video ngắn dọc 9:16 người que — tự động đẩy S3 & DB</p>
              </div>
              <ShortsStudioSection
                key="shorts-studio-9-16"
                studioFormat="short"
                onVideoSynced={() => loadVideos(1)}
                onOpenPublishModal={(v) => setSelectedVideo(v)}
              />
            </>
          ) : activeSection === 'long-studio' ? (
            <>
              <div className="page-header">
                <h1>🖥️ Video Dài 16:9 Studio (AI · Màn Ngang Full HD)</h1>
                <p>Sáng tác nội dung chuyên sâu, đọc giọng AI & render video Người Que màn ngang 1920×1080 chuẩn YouTube / Facebook / TikTok Long</p>
              </div>
              <ShortsStudioSection
                key="long-studio-16-9"
                studioFormat="long"
                onVideoSynced={() => loadVideos(1)}
                onOpenPublishModal={(v) => setSelectedVideo(v)}
              />
            </>
          ) : (
            <>
              <div className="page-header">
                <h1>{activeSection === 'products' ? 'Products' : activeSection === 'videos' ? 'Videos' : 'Dashboard'}</h1>
                <p>Manage your AI-generated affiliate marketing videos</p>
              </div>

              <StatsGrid
                totalVideos={totalVideos}
                pipelineRunning={pipelineRunning}
                pipelineLastRun={pipelineLastRun}
                totalProducts={totalProducts}
                totalTiktok={totalTiktok}
              />

              {/* Section: Dashboard / Videos */}
              {(activeSection === 'dashboard' || activeSection === 'videos') && (
                <VideoGallery
                  videos={videos}
                  products={products}
                  currentPage={videoPage}
                  totalPages={videoTotalPages}
                  isLoading={isVideoLoading}
                  videoFormatTab={videoFormatTab}
                  onChangeVideoFormatTab={(tab) => {
                    setVideoFormatTab(tab);
                    loadVideos(1, tab);
                  }}
                  onPageChange={(page) => loadVideos(page, videoFormatTab)}
                  onRefresh={() => loadVideos(videoPage, videoFormatTab)}
                  onOpenConcatModal={() => setIsConcatModalOpen(true)}
                  onPlayVideo={(v) => setSelectedVideo(v)}
                  onPublishVideo={handlePublishVideo}
                />
              )}

              {/* Section: Products (visible when Products tab selected) */}
              {activeSection === 'products' && (
                <ProductsTable
                  products={products}
                  currentPage={productPage}
                  totalPages={productTotalPages}
                  isLoading={isProductLoading}
                  onPageChange={(page) => loadProducts(page)}
                  onAddProduct={() => {
                    setProductToEdit(null);
                    setIsProductModalOpen(true);
                  }}
                  onOpenCrawlModal={() => setIsCrawlModalOpen(true)}
                  onEditProduct={(p) => {
                    setProductToEdit(p);
                    setIsProductModalOpen(true);
                  }}
                  onDeleteProduct={handleDeleteProduct}
                  onGenerateForProduct={(p) => {
                    setGenerateProduct(p);
                    setIsGenerateModalOpen(true);
                  }}
                  onZoomImage={(url) => setLightboxImage(url)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Modals */}
      <GenerateVideoModal
        isOpen={isGenerateModalOpen}
        onClose={() => {
          setIsGenerateModalOpen(false);
          loadProducts(productPage);
        }}
        initialProduct={generateProduct}
        onSuccess={() => {
          loadVideos(1);
          loadProducts(productPage);
        }}
        onZoomImage={(url) => setLightboxImage(url)}
      />

      <ProductModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        productToEdit={productToEdit}
        onSaveSuccess={() => loadProducts(productPage)}
        onZoomImage={(url) => setLightboxImage(url)}
      />

      <CrawlModal
        isOpen={isCrawlModalOpen}
        onClose={() => setIsCrawlModalOpen(false)}
        onCrawlSuccess={() => loadProducts(1)}
      />

      <CharacterModal
        isOpen={isCharacterModalOpen}
        onClose={() => setIsCharacterModalOpen(false)}
      />

      <ConcatModal
        isOpen={isConcatModalOpen}
        onClose={() => setIsConcatModalOpen(false)}
        onConcatSuccess={() => loadVideos(1)}
        availableVideos={videos}
      />

      <VideoPlayerModal
        video={selectedVideo}
        isOpen={selectedVideo !== null}
        onClose={() => setSelectedVideo(null)}
        onUpdateSuccess={() => loadVideos(videoPage)}
      />

      <Lightbox
        imageUrl={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <AppContent />
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}
