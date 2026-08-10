import { getSupabaseClient } from '../config/supabase.js';
import { successResponse, errorResponse } from '../utils/response.js';

// Default Coffee Products Seed/Fallback Data (used when Supabase is not yet seeded)
const DEFAULT_PRODUCTS = [
  {
    id: 'prod-01',
    name: 'Arume Signature Latte',
    description: 'Espresso blend pilihan dengan susu segar dan sentuhan sirup aren organik.',
    price: 28000,
    category: 'Coffee',
    image_url: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&w=600&q=80',
    stock: 50,
    is_active: true
  },
  {
    id: 'prod-02',
    name: 'Spanish Caramel Cold Brew',
    description: 'Cold brew direndam 16 jam, dipadukan dengan karamel gurih dan susu keju.',
    price: 32000,
    category: 'Coffee',
    image_url: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=600&q=80',
    stock: 40,
    is_active: true
  },
  {
    id: 'prod-03',
    name: 'Uji Matcha Cream',
    description: 'Matcha grade A dari Uji, Kyoto disajikan dengan cold foam lembut.',
    price: 35000,
    category: 'Non-Coffee',
    image_url: 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=600&q=80',
    stock: 30,
    is_active: true
  },
  {
    id: 'prod-04',
    name: 'Earl Grey Boba Tea',
    description: 'Teh Earl Grey aromatik diseduh segar dengan tapioca boba manis.',
    price: 26000,
    category: 'Non-Coffee',
    image_url: 'https://images.unsplash.com/photo-1558857563-b371033873b8?auto=format&fit=crop&w=600&q=80',
    stock: 35,
    is_active: true
  },
  {
    id: 'prod-05',
    name: 'Butter Croissant',
    description: 'Croissant khas Perancis dipanggang segar tiap pagi dengan mentega murni.',
    price: 25000,
    category: 'Pastry',
    image_url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80',
    stock: 20,
    is_active: true
  },
  {
    id: 'prod-06',
    name: 'Pain au Chocolat',
    description: 'Pastry berlapis dengan isian dark chocolate couverture melt-in-mouth.',
    price: 28000,
    category: 'Pastry',
    image_url: 'https://images.unsplash.com/photo-1608198093002-ad4e005484ec?auto=format&fit=crop&w=600&q=80',
    stock: 15,
    is_active: true
  }
];

/**
 * GET /api/products
 * Retrieves list of products.
 */
export const getProducts = async (c) => {
  try {
    const supabase = getSupabaseClient(c.env);
    const category = c.req.query('category');

    if (supabase) {
      let query = supabase.from('products').select('*').eq('is_active', true);
      if (category) {
        query = query.ilike('category', category);
      }

      const { data, error } = await query;

      if (!error && data && data.length > 0) {
        return successResponse(c, data, 'Products retrieved successfully');
      }
    }

    // Fallback if Supabase not configured or database empty
    let filtered = DEFAULT_PRODUCTS;
    if (category) {
      filtered = DEFAULT_PRODUCTS.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }

    return successResponse(c, filtered, 'Products retrieved successfully (Default catalog)');
  } catch (err) {
    return errorResponse(c, 'Failed to fetch products', err, 500);
  }
};

/**
 * GET /api/products/:id
 * Retrieves product details by ID.
 */
export const getProductById = async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return errorResponse(c, 'Product ID is required', null, 400);
    }

    const supabase = getSupabaseClient(c.env);

    if (supabase) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (!error && data) {
        return successResponse(c, data, 'Product details retrieved successfully');
      }
    }

    // Fallback check in default catalog
    const product = DEFAULT_PRODUCTS.find(p => p.id === id);
    if (product) {
      return successResponse(c, product, 'Product details retrieved successfully');
    }

    return errorResponse(c, 'Product not found', `No product found with ID ${id}`, 404);
  } catch (err) {
    return errorResponse(c, 'Failed to fetch product details', err, 500);
  }
};

/**
 * Helper to resolve products by IDs for order price validation
 */
export const getProductsByIds = async (env, productIds = []) => {
  const supabase = getSupabaseClient(env);
  
  if (supabase) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .in('id', productIds);

    if (!error && data && data.length > 0) {
      return data;
    }
  }

  // Fallback to DEFAULT_PRODUCTS catalog
  return DEFAULT_PRODUCTS.filter(p => productIds.includes(p.id));
};
