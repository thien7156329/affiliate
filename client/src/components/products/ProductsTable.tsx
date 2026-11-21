import React, { useState } from 'react';
import { Product } from '../../types';
import { getDisplayImageUrl } from '../../utils/image';

interface ProductsTableProps {
  products: Product[];
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  onAddProduct: () => void;
  onOpenCrawlModal: () => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
  onGenerateForProduct: (product: Product) => void;
  onZoomImage?: (url: string) => void;
}

export const ProductsTable: React.FC<ProductsTableProps> = ({
  products,
  currentPage,
  totalPages,
  isLoading,
  onPageChange,
  onAddProduct,
  onOpenCrawlModal,
  onEditProduct,
  onDeleteProduct,
  onGenerateForProduct,
  onZoomImage,
}) => {
  const [hoverImg, setHoverImg] = useState<{ src: string; x: number; y: number; name: string } | null>(null);
  return (
    <div id="sectionProducts">
      <div className="section-header">
        <h2>🛍️ Products</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-sm"
            onClick={onOpenCrawlModal}
            style={{
              background: 'rgba(124,58,237,0.12)',
              borderColor: 'rgba(124,58,237,0.3)',
              color: '#a78bfa',
            }}
          >
            🔗 Import từ Link
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={onAddProduct}
          >
            + Add Product
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 'auto' }}>Name</th>
              <th style={{ width: '120px' }}>Category</th>
              <th style={{ width: '180px' }}>Hashtags</th>
              <th style={{ width: '275px' }}>Actions</th>
            </tr>
          </thead>
          <tbody id="productsTable">
            {isLoading ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '32px' }}>
                  Loading products...
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '32px' }}>
                  No products. Add one!
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const imgRaw = p.image_url || (p.images && p.images[0]);
                const displayImg = getDisplayImageUrl(imgRaw);

                return (
                  <tr key={p.id}>
                    <td data-label="Product" style={{ minWidth: 0, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, width: '100%' }}>
                        {displayImg ? (
                          <div
                            onClick={() => {
                              setHoverImg(null);
                              onZoomImage?.(displayImg);
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'scale(1.15)';
                              const rect = e.currentTarget.getBoundingClientRect();
                              let x = rect.right + 12;
                              if (x + 280 > window.innerWidth - 16) x = Math.max(16, rect.left - 292);
                              const y = Math.min(Math.max(16, rect.top - 40), window.innerHeight - 310);
                              setHoverImg({ src: displayImg, x, y, name: p.name });
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'scale(1)';
                              setHoverImg(null);
                            }}
                            title="🔍 Rê chuột để xem nhanh • Click để phóng to"
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              backgroundImage: `url('${displayImg}')`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              border: '1px solid var(--border)',
                              flexShrink: 0,
                              cursor: 'zoom-in',
                              transition: 'transform 0.15s ease',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              background: 'var(--bg3)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '1px solid var(--border)',
                              fontSize: '16px',
                              flexShrink: 0,
                            }}
                          >
                            📦
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          <strong
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              lineHeight: 1.4,
                              color: 'var(--text)',
                            }}
                            title={p.name}
                          >
                            {p.name}
                          </strong>
                          {p.created_at && (
                            <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <span>🕒</span>
                              <span>{new Date(p.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="Category" style={{ whiteSpace: 'nowrap' }}>
                      <span className={`pill ${p.category}`}>{p.category}</span>
                    </td>
                    <td
                      data-label="Hashtags"
                      style={{
                        color: 'var(--muted)',
                        fontSize: '12px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                      title={(p.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                    >
                      {(p.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                    </td>
                    <td data-label="Actions" style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn-action primary"
                          style={{ padding: '6px 12px', borderRadius: '7px', boxShadow: 'none', whiteSpace: 'nowrap' }}
                          onClick={() => onGenerateForProduct(p)}
                        >
                          🚀 Generate
                        </button>
                        <button
                          type="button"
                          className="btn-action"
                          style={{ padding: '6px 12px', borderRadius: '7px', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', whiteSpace: 'nowrap' }}
                          onClick={() => onEditProduct(p)}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          className="btn-action"
                          style={{ padding: '6px 12px', borderRadius: '7px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', whiteSpace: 'nowrap' }}
                          onClick={() => onDeleteProduct(p.id)}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination-container" id="productPagination">
          <button
            type="button"
            className="pagination-btn"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            ◀ Prev
          </button>
          <span className="pagination-info">
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="pagination-btn"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            Next ▶
          </button>
        </div>
      )}

      {hoverImg && (
        <div
          style={{
            position: 'fixed',
            left: `${hoverImg.x}px`,
            top: `${hoverImg.y}px`,
            width: '280px',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(12px)',
            border: '1.5px solid rgba(168,85,247,0.55)',
            borderRadius: '14px',
            padding: '10px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.85)',
            zIndex: 100000,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ width: '100%', height: '240px', borderRadius: '10px', overflow: 'hidden', background: '#090d16', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={hoverImg.src} alt={hoverImg.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hoverImg.name}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>🔍 Click vào ảnh để xem toàn màn hình</div>
        </div>
      )}
    </div>
  );
};
