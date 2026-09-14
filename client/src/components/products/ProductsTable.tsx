import React from 'react';
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
}) => {
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
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Hashtags</th>
              <th>Actions</th>
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
                    <td data-label="Product" style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, width: '100%' }}>
                        {displayImg ? (
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              backgroundImage: `url('${displayImg}')`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              border: '1px solid var(--border)',
                              flexShrink: 0,
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              lineHeight: 1.4,
                              wordBreak: 'break-word',
                              maxWidth: '320px',
                            }}
                            title={p.name}
                          >
                            {p.name}
                          </strong>
                          {p.created_at && (
                            <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>🕒</span>
                              <span>{new Date(p.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="Category">
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
                        maxWidth: '200px',
                        minWidth: 0,
                      }}
                      title={(p.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                    >
                      {(p.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                    </td>
                    <td data-label="Actions">
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn-action primary"
                          style={{ padding: '6px 12px', borderRadius: '7px', boxShadow: 'none' }}
                          onClick={() => onGenerateForProduct(p)}
                        >
                          🚀 Generate
                        </button>
                        <button
                          type="button"
                          className="btn-action"
                          style={{ padding: '6px 12px', borderRadius: '7px', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)' }}
                          onClick={() => onEditProduct(p)}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          className="btn-action"
                          style={{ padding: '6px 12px', borderRadius: '7px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
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
    </div>
  );
};
