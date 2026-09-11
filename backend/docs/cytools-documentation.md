# CYTools Documentation

Markdown export of the official CYTools documentation (https://cy.tools/docs/documentation), covering the six main classes (Polytope, PolytopeFace, Triangulation, ToricVariety, CalabiYau, Cone), miscellaneous functions, configuration, experimental features, and license.


---

# Overview

Source: https://cy.tools/docs/documentation

CYTools provides six main Python classes containing various functions specific to the object they describe. These classes are the following:

- [`Polytope`](https://cy.tools/docs/documentation/polytope) This class handles all computations relating to lattice polytopes, such as
  the computation of lattice points and faces. When using reflexive
  polytopes, it also allows the computation of topological properties of the
  arising Calabi-Yau hypersurfaces that only depend on the polytope.
- [`PolytopeFace`](https://cy.tools/docs/documentation/polytopeface) This class handles all computations relating to faces of lattice polytopes.
- [`Triangulation`](https://cy.tools/docs/documentation/triangulation) This class handles triangulations of lattice polytopes. It can compute
  various properties of the triangulation, as well as construct a
  ToricVariety or CalabiYau object if the triangulation is suitable.
- [`ToricVariety`](https://cy.tools/docs/documentation/toricvariety) This class handles various computations relating to toric varieties.
  It can be used to compute intersection numbers and the Kähler cone, among
  other things.
- [`CalabiYau`](https://cy.tools/docs/documentation/calabiyau) This class handles various computations relating to the Calabi-Yau manifold
  itself. It can be used to compute intersection numbers and the toric Mori and
  Kähler cones, among other things.
- [`Cone`](https://cy.tools/docs/documentation/cone) This class handles all computations relating to rational polyhedral cones,
  such cone duality and extremal ray computations. It is mainly used for the
  study of Kähler and Mori cones.

Apart from the above classes there are other miscellaneous functions that we document in the misc functions page. There are also a few configuration options that can be found in the configuration page, and some experimental features documented in the experimental features page.

[Misc functions](https://cy.tools/docs/documentation/other)    [Configuration](https://cy.tools/docs/documentation/config)    [Experimental features](https://cy.tools/docs/documentation/experimental)

  

CYTools is open-source software distributed under the [GNU GPL3 license](https://www.gnu.org/licenses/gpl-3.0.txt). See the license page for more details.

[License](https://cy.tools/docs/documentation/license)

---

# Polytope Class

Source: https://cy.tools/docs/documentation/polytope

This class handles all computations relating to lattice polytopes, such as
the computation of lattice points and faces. When using reflexive
polytopes, it also allows the computation of topological properties of the
arising Calabi-Yau hypersurfaces that only depend on the polytope.

## Constructor

### `cytools.polytope.Polytope`

**Description:**
Constructs a `Polytope` object describing a lattice polytope. This is
handled by the hidden [`__init__`](#__init__) function.

**NOTES:**

- CYTools only supports lattice polytopes, so any floating point numbers
  will be truncated to integers.
- The Polytope class is also imported to the root of the CYTools package,
  so it can be imported from `cytools.polytope` or from `cytools`.

**Arguments:**

- `points`: A list of lattice points defining the polytope as their
  convex hull.
- `labels`: A list of labels to specify the points. I.e., points[i] is
  labelled/accessed as labels[i]. If no labels are provided, then the
  points are given semi-arbitrary default labels.
- `backend`: A string that specifies the backend used to construct the
  convex hull. The available options are "ppl", "qhull", or "palp".
  When not specified, it uses PPL for dimensions up to four, and palp
  otherwise.

**Example:**

We construct two polytopes from lists of points.

```python
from cytools import Polytope
p1 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
print(p1)
# A 4-dimensional reflexive lattice polytope in ZZ^4
p2 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[-1,-1,-1,0]])
print(p2)
# A 3-dimensional lattice polytope in ZZ^4
```

---

## Functions

### `all_triangulations`

**Description:**
Computes all triangulations of the polytope using TOPCOM. There is the
option to only compute fine, regular or fine triangulations.

**WARNING:**

Polytopes with more than around 15 points usually have too many
triangulations, so this function may take too long or run out of
memory.

**Arguments:**

- `only_fine`: Restricts to only fine triangulations.
- `only_regular`: Restricts to only regular triangulations.
- `only_star`: Restricts to only star triangulations. When not
  specified it defaults to True for reflexive polytopes and False
  otherwise.
- `star_origin`: The index of the point that will be used as the star
  origin. If the polytope is reflexive this is set to 0, but
  otherwise it must be specified.
- `include_points_interior_to_facets`: Whether to include points
  interior to facets from the triangulation.
- `points`: List of point labels that will be used. Note that if this
  option is used then the parameter
  `include_points_interior_to_facets` is ignored.
- `backend`: The optimizer used to check regularity computation. The
  available options are the backends of the
  [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid) function of the [`Cone`](https://cy.tools/docs/documentation/cone)
  class. If not specified, it will be picked automatically. Note that
  TOPCOM is not used to check regularity since it is much slower.
- `as_list`: By default this function returns a generator object, which
  is usually desired for efficiency. However, this flag can be set to
  True so that it returns the full list of triangulations at once.
- `raw_output`: Return the triangulations as lists of simplices instead
  of as Triangulation objects.

**Returns:**
A generator of [`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects, or a list of
[`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects if `as_list` is set to True.

**Example:**

We construct a polytope and find all of its triangulations. We try
picking different restrictions and see how the number of triangulations
changes.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-2,-1,-1],[-2,-1,-1,-1]])
g = p.all_triangulations()
next(g) # Takes some time while TOPCOM finds all the triangulations
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
next(g) # Produces the next triangulation immediately
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
len(p.all_triangulations(as_list=True)) # Number of fine, regular, star triangulations
# 2
len(p.all_triangulations(only_regular=False, only_star=False, only_fine=False, as_list=True) )# Number of triangularions, no matter if fine, regular, or star
# 6
```

---

### `ambient_dimension`

**Description:**
Returns the dimension of the ambient lattice.

**Arguments:**
None.

**Returns:**
The dimension of the ambient lattice.

**Aliases:**
`ambient_dim`.

**Example:**

We construct a polytope and check the dimension of the ambient lattice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[-1,-1,-1,0]])
p.ambient_dimension()
# 4
```

---

### `automorphisms`

## r

### `backend`

**Description:**
Returns the backend.

**Arguments:**
None.

**Returns:**
The computational backend

---

### `chi`

**Description:**
Computes the Euler characteristic of the Calabi-Yau obtained as the
anticanonical hypersurface in the toric variety given by a
desingularization of the face or normal fan of the polytope when the
lattice is specified as "N" or "M", respectively.

**NOTE:**

Only reflexive polytopes of dimension 2-5 are currently supported.

**Arguments:**

- `lattice`: Specifies the lattice on which the polytope is defined.
  Options are "N" and "M".

**Returns:**
The Euler characteristic of the arising Calabi-Yau manifold.

**Example:**

We construct a polytope and compute the Euler characteristic of the
associated hypersurfaces.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.chi(lattice="N")
# -540
p.chi(lattice="M")
# 540
```

---

### `clear_cache`

**Description:**
Clears the cached results of any previous computation.

**Arguments:**
None.

**Returns:**
Nothing.

**Example:**

We compute the lattice points of a large polytope.

```python
p = Polytope([[-1,-1,-1,-1,-1],[3611,-1,-1,-1,-1],[-1,42,-1,-1,-1],[-1,-1,6,-1,-1],[-1,-1,-1,2,-1],[-1,-1,-1,-1,1]])
pts = p.points() # Takes a few seconds
pts = p.points() # It runs instantly because the result is cached
p.clear_cache() # Clears the results of any previous computation
pts = p.points() # Again it takes a few seconds since the cache was cleared
```

---

### `dimension`

**Description:**
Returns the dimension of the polytope.

**Arguments:**
None.

**Returns:**
The dimension of the polytope.

**Aliases:**
`dim`.

**Example:**

We construct a polytope and check its dimension.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[-1,-1,-1,0]])
p.dimension()
# 3
```

---

### `dual_polytope`

## r

### `faces`

**Description:**
Computes the faces of a polytope.

**NOTE:**

When the polytope is 4-dimensional it calls the slightly more optimized
[`_faces4d()`](#_faces4d) function.

**Arguments:**

- `d`: Optional parameter that specifies the dimension of the desired
  faces.

**Returns:**
A tuple of [`PolytopeFace`](https://cy.tools/docs/documentation/polytopeface) objects of dimension d, if
specified. Otherwise, a tuple of tuples of
[`PolytopeFace`](https://cy.tools/docs/documentation/polytopeface) objects organized in ascending
dimension.

**Example:**

We show that this function returns a tuple of 2-faces if `d` is set to
2. Otherwise, the function returns all faces in tuples organized in
ascending dimension. We verify that the first element in the tuple of
2-faces is the same as the first element in the corresponding subtuple
in the tuple of all faces.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
faces2d = p.faces(2)
allfaces = p.faces()
print(faces2d[0]) # Print first face in tuple of 2-faces
# A 2-dimensional face of a 4-dimensional polytope in ZZ^4
faces2d[0] is allfaces[2][0]
# True
```

---

### `facets`

**Description:**
Returns the facets (codimension-1 faces) of the polytope.

**Arguments:**
None.

**Returns:**
A list of [`PolytopeFace`](https://cy.tools/docs/documentation/polytopeface) objects of codimension 1.

**Example:**

We construct a polytope and find its facets.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
facets = p.facets()
```

---

### `find_2d_reflexive_subpolytopes`

**Description:**
Use the algorithm by Huang and Taylor described in
[1907.09482](https://arxiv.org/abs/1907.09482) to find 2D reflexive
subpolytopes in 4D polytopes.

**Arguments:**
None.

**Returns:**
The list of 2D reflexive subpolytopes.

**Example:**

We construct a polytope and find its 2D reflexive subpolytopes.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.find_2d_reflexive_subpolytopes()
# [A 2-dimensional lattice polytope in ZZ^4]
```

---

### `glsm_basis`

**Description:**
Computes a basis of columns of the GLSM charge matrix.

**Arguments:**

- `include_origin`: Indicates whether to use the origin in the
  calculation. This corresponds to the inclusion of the canonical
  divisor.
- `include_points_interior_to_facets`: By default only boundary points
  not interior to facets are used. If this flag is set to true then
  points interior to facets are also used.
- `points`: The list of indices of the points that will be used. Note
  that if this option is used then the parameters `include_origin`
  and `include_points_interior_to_facets` are ignored. Also, note
  that the indices returned here will be the indices of the sorted
  list of points.
- `integral`: Indicates whether to find an integral basis for the
  columns of the GLSM charge matrix. (i.e. so that remaining columns
  can be written as an integer linear combination of the basis
  elements.)

**Returns:**
A list of column indices that form a basis.

**Example:**

We construct a polytope, find its GLSM charge matrix and a basis of
columns.

```python
import numpy as np
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.glsm_basis()
# array([1, 6])
glsm = p.glsm_charge_matrix()
np.linalg.matrix_rank(glsm) == np.linalg.matrix_rank(glsm[:,p.glsm_basis()]) # This shows that the columns form a basis
# True
```

---

### `glsm_charge_matrix`

**Description:**
Computes the GLSM charge matrix of the theory resulting from this
polytope.

**Arguments:**

- `include_origin`: Indicates whether to use the origin in the
  calculation. This corresponds to the inclusion of the canonical
  divisor.
- `include_points_interior_to_facets`: By default only boundary points
  not interior to facets are used. If this flag is set to true then
  points interior to facets are also used.
- `points`: The list of indices of the points that will be used. Note
  that if this option is used then the parameters `include_origin`
  and `include_points_interior_to_facets` are ignored.
- `integral`: Indicates whether to find an integral basis for the
  columns of the GLSM charge matrix. (i.e. so that remaining columns
  can be written as an integer linear combination of the basis
  elements.)

**Returns:**
The GLSM charge matrix.

**Example:**

We construct a polytope and find the GLSM charge matrix with different
parameters.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.glsm_charge_matrix()
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
p.glsm_charge_matrix().dot(p.points_not_interior_to_facets()) # By definition this product must be zero
# array([[0, 0, 0, 0],
#        [0, 0, 0, 0]])
p.glsm_charge_matrix(include_origin=False) # Excludes the canonical divisor
# array([[1, 9, 6, 1, 1, 0],
#        [0, 3, 2, 0, 0, 1]])
p.glsm_charge_matrix(include_points_interior_to_facets=True) # Includes points interior to facets
# array([[-18,   1,   9,   6,   1,   1,   0,   0,   0,   0],
#        [ -6,   0,   3,   2,   0,   0,   1,   0,   0,   0],
#        [ -4,   0,   2,   1,   0,   0,   0,   1,   0,   0],
#        [ -3,   0,   1,   1,   0,   0,   0,   0,   1,   0],
#        [ -2,   0,   1,   0,   0,   0,   0,   0,   0,   1]])
```

---

### `glsm_linear_relations`

**Description:**
Computes the linear relations of the GLSM charge matrix.

**Arguments:**

- `include_origin`: Indicates whether to use the origin in the
  calculation. This corresponds to the inclusion of the canonical
  divisor.
- `include_points_interior_to_facets`: By default only boundary points
  not interior to facets are used. If this flag is set to true then
  points interior to facets are also used.
- `points`: The list of indices of the points that will be used. Note
  that if this option is used then the parameters `include_origin`
  and `include_points_interior_to_facets` are ignored.
- `integral`: Indicates whether to find an integral basis for the
  columns of the GLSM charge matrix. (i.e. so that remaining columns
  can be written as an integer linear combination of the basis
  elements.)

**Returns:**
A matrix of linear relations of the columns of the GLSM charge matrix.

**Example:**

We construct a polytope and find its GLSM charge matrix and linear
relations with different parameters.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.glsm_linear_relations()
# array([[ 1,  1,  1,  1,  1,  1,  1],
#        [ 0,  9, -1,  0,  0,  0,  3],
#        [ 0,  6,  0, -1,  0,  0,  2],
#        [ 0,  1,  0,  0, -1,  0,  0],
#        [ 0,  1,  0,  0,  0, -1,  0]])
p.glsm_linear_relations().dot(p.glsm_charge_matrix().T) # By definition this product must be zero
# array([[0, 0],
#        [0, 0],
#        [0, 0],
#        [0, 0],
#        [0, 0]])
p.glsm_linear_relations(include_origin=False) # Excludes the canonical divisor
# array([[ 9, -1,  0,  0,  0,  3],
#        [ 6,  0, -1,  0,  0,  2],
#        [ 1,  0,  0, -1,  0,  0],
#        [ 1,  0,  0,  0, -1,  0]])
p.glsm_linear_relations(include_points_interior_to_facets=True) # Includes points interior to facets
# array([[ 1,  1,  1,  1,  1,  1,  1,  1,  1,  1],
#        [ 0,  9, -1,  0,  0,  0,  3,  2,  1,  1],
#        [ 0,  6,  0, -1,  0,  0,  2,  1,  1,  0],
#        [ 0,  1,  0,  0, -1,  0,  0,  0,  0,  0],
#        [ 0,  1,  0,  0,  0, -1,  0,  0,  0,  0]])
```

---

### `hpq`

**Description:**
Returns the Hodge number \(h^{p,q}\) of the Calabi-Yau obtained as the
anticanonical hypersurface in the toric variety given by a
desingularization of the face or normal fan of the polytope when the
lattice is specified as "N" or "M", respectively.

**NOTES:**

- Only reflexive polytopes of dimension 2-5 are currently supported.

**Arguments:**

- `p`: The holomorphic index of the Dolbeault cohomology of interest.
- `q`: The anti-holomorphic index of the Dolbeault cohomology of
  interest.
- `lattice`: Specifies the lattice on which the polytope is defined.
  Options are "N" and "M".

**Returns:**
The Hodge number \(h^{p,q}\) of the arising Calabi-Yau manifold.

**Example:**

We construct a polytope and check some Hodge numbers of the associated
hypersurfaces.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.hpq(0,0,lattice="N")
# 1
p.hpq(0,1,lattice="N")
# 0
p.hpq(1,1,lattice="N")
# 2
p.hpq(1,2,lattice="N")
# 272
```

---

### `inequalities`

## r

### `inequivalent_Z2_actions`

**Description:**
Enumerates inequivalent toric `Z_2` actions. I.e., the half-integer
lattice points defining `Z_2` torus actions modulo the polytope's
lattice automorphisms.

**Arguments:**
None.

**Returns:**

- `numpy.ndarray`: Inequivalent integer representatives `q` such that
  `q/2` defines a `Z_2` action.

**Example:**

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p.inequivalent_Z2_actions()
# array([[0, 0, 0, 1],
#        [0, 0, 1, 1]])
```

---

### `is_affinely_equivalent`

**Description:**
Returns True if the polytopes can be transformed into each other by an
integral affine transformation.

**Arguments:**

- `other`: The other polytope being compared.
- `backend`: Selects which backend to use to compute the normal form.
  Options are "native", which uses native python code, or "palp",
  which uses PALP for the computation.

**Returns:**
The truth value of the polytopes being affinely equivalent.

**Example:**

We construct two polytopes and check if they are affinely equivalent.

```python
p1 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p2 = Polytope([[1,0,0,1],[0,1,0,1],[0,0,1,1],[0,0,0,2],[-1,-1,-1,0]])
p1.is_affinely_equivalent(p2)
# True
```

---

### `is_favorable`

**Description:**
Returns True if the Calabi-Yau hypersurface arising from this polytope
is favorable (i.e. all Kahler forms descend from Kahler forms on the
ambient toric variety) and False otherwise.

**NOTE:**

Only reflexive polytopes of dimension 2-5 are currently supported.

**Arguments:**

- `lattice`: Specifies the lattice on which the polytope is
  defined. Options are "N" and "M".

**Returns:**
*(bool)* The truth value of the polytope being favorable.

**Example:**

We construct two reflexive polytopes and find whether they are
favorable when considered in the N lattice.

```python
p1 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p2 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-3,-6]])
p1.is_favorable(lattice="N")
# True
p2.is_favorable(lattice="N")
# False
```

---

### `is_linearly_equivalent`

## r

### `is_reflexive`

**Description:**
Returns True if the polytope is reflexive and False otherwise.

**Arguments:**

- `allow_translations`: Whether to allow the polytope to be translated.

**Returns:**
The truth value of the polytope being reflexive.

**Example:**

We construct a polytope and check if it is reflexive.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.is_reflexive()
# True
```

---

### `is_solid`

**Description:**
Returns True if the polytope is solid (i.e. full-dimensional) and False
otherwise.

**Arguments:**
None.

**Returns:**
The truth value of the polytope being full-dimensional.

**Example:**

We construct a polytope and check if it is solid.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[-1,-1,-1,0]])
p.is_solid()
# False
```

---

### `is_trilayer`

Check if a polytope is 'trilayer'.

---

### `labels`

**Description:**
Returns the point labels, in order.

---

### `minkowski_sum`

**Description:**
Returns the Minkowski sum of the two polytopes.

**Arguments:**

- `other`: The other polytope used for the Minkowski sum.

**Returns:**
The Minkowski sum.

**Example:**

We construct two polytopes and compute their Minkowski sum.

```python
p1 = Polytope([[1,0,0],[0,1,0],[-1,-1,0]])
p2 = Polytope([[0,0,1],[0,0,-1]])
p1.minkowski_sum(p2)
# A 3-dimensional reflexive lattice polytope in ZZ^3
```

---

### `nef_partitions`

**Description:**
Computes the nef partitions of the polytope using PALP.

**NOTE:**

This is currently an experimental feature and may change significantly
in future versions.

**Arguments:**

- `keep_symmetric`: Keep symmetric partitions related by lattice
  automorphisms.
- `keep_products`: Keep product partitions corresponding to complete
  intersections being direct products.
- `keep_projections`: Keep projection partitions, i.e. partitions where
  one of the parts consists of a single vertex.
- `codim`: The number of parts in the partition or, equivalently, the
  codimension of the complete intersection Calabi-Yau.
- `compute_hodge_numbers`: Indicates whether Hodge numbers of the CICY
  are computed.
- `return_hodge_numbers`: Indicates whether to return the Hodge numbers
  along with the nef partitions. They are returned in a separate
  tuple and they are ordered as in the Hodge diamond from top to
  bottom and left to right.

**Returns:**
The nef partitions of the polytope. If return\_hodge\_numbers is set to
True then two tuples are returned, one with the nef partitions and one
with the corresponding Hodge numbers.

**Example:**

We construct a tesseract and find the 2- and 3-part nef partitions.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,0,0,0],[0,-1,0,0],[0,0,-1,0],[0,0,0,-1]])
nef_part_2 = p.nef_partitions() # Default codimension is 2
print(nef_part_2[0]) # Print the first of the nef partitions
# ((5, 2, 3, 4), (8, 7, 6, 1))
nef_part_3 = p.nef_partitions(codim=3) # Codimension 3
print(nef_part_3[0]) # Print the first of the nef partitions
# ((6, 5, 3), (2, 4), (8, 7, 1))
```

---

### `normal_form`

## r

### `points`

**Description:**
Returns the lattice points of the polytope.

**NOTE:**

Points are sorted so that interior points are first, and then the rest
are arranged by decreasing number of saturated inequalities and
lexicographically. For reflexive polytopes this is useful since the
origin will be at index 0 and boundary points interior to facets will
be last.

**Arguments:**

- `which`: Which points to return. Specified by a (list of) labels.
  NOT INDICES!!!
- `optimal`: Whether to return the points in their optimal coordinates.
- `as_indices`: Return the points as indices of the full list of points
  of the polytope.

**Returns:**
The list of lattice points of the polytope.

**Aliases:**
`pts`.

**Example:**

We construct a polytope and compute the lattice points. One can verify
that the first point is the only interior point, and the last three
points are the ones interior to facets. Thus it follows the
aforementioned ordering.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.points()
# array([[ 0,  0,  0,  0],
#        [-1, -1, -6, -9],
#        [ 0,  0,  0,  1],
#        [ 0,  0,  1,  0],
#        [ 0,  1,  0,  0],
#        [ 1,  0,  0,  0],
#        [ 0,  0, -2, -3],
#        [ 0,  0, -1, -2],
#        [ 0,  0, -1, -1],
#        [ 0,  0,  0, -1]])
```

---

### `points_to_indices`

**Description:**
Returns the list of indices corresponding to the given points. It also
accepts a single point, in which case it returns the corresponding
index.

**Arguments:**

- `points`: A point or a list of points.
- `is_optimal`: Whether the points argument represents points in the
  optimal (True) or input (False) basis

**Returns:**
The list of indices corresponding to the given points, or the index of
the point if only one is given.

**Example:**

We construct a polytope and find the indices of some of its points.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.points_to_indices([-1,-1,-6,-9]) # We input a single point, so a single index is returned
# 1
p.points_to_indices([[-1,-1,-6,-9],[0,0,0,0],[0,0,1,0]]) # We input a list of points, so a list of indices is returned
# array([1, 0, 3])
```

---

### `points_to_labels`

**Description:**
Returns the list of labels corresponding to the given points. It also
accepts a single point, in which case it returns the corresponding
label.

**Arguments:**

- `points`: A point or a list of points.
- `is_optimal`: Whether the points argument represents points in the
  optimal (True) or input (False) basis

**Returns:**
The list of labels corresponding to the given points, or the label of
the point if only one is given.

---

### `random_triangulations_fair`

## r

### `random_triangulations_fast`

**Description:**
Constructs pseudorandom regular (optionally fine and star)
triangulations of a given point set. This is done by picking random
heights around the Delaunay heights from a Gaussian distribution.

**IMPORTANT:**

This function produces random triangulations very quickly, but it does
not produce a fair sample. When a fair sampling is required the
[`random_triangulations_fair`](#random_triangulations_fair)
function should be used.

**Arguments:**

- `N`: Number of desired unique triangulations. If not specified, it
  will generate as many triangulations as it can find until it has to
  retry more than `max_retries` times to obtain a new triangulation.
  This parameter is required when setting `as_list` to True.
- `c`: A constant used as the standard deviation of the Gaussian
  distribution used to pick the heights. A larger `c` results in a
  wider range of possible triangulations, but with a larger fraction
  of them being non-fine, which slows down the process when
  `only_fine` is set to True.
- `max_retries`: Maximum number of attempts to obtain a new
  triangulation before the process is terminated.
- `make_star`: Converts the obtained triangulations into star
  triangulations. If not specified, defaults to True for reflexive
  polytopes, and False for other polytopes.
- `only_fine`: Restricts to fine triangulations.
- `include_points_interior_to_facets`: Whether to include points
  interior to facets from the triangulation. If not specified, it is
  set to False for reflexive polytopes and True otherwise.
- `points`: List of point labels that will be used. Note that if this
  option is used then the parameter
  `include_points_interior_to_facets` is ignored.
- `backend`: Specifies the backend used to compute the triangulation.
  The available options are "cgal" and "qhull".
- `as_list`: By default this function returns a generator object, which
  is usually desired for efficiency. However, this flag can be set to
  True so that it returns the full list of triangulations at once.
- `progress_bar`: Shows the number of triangulations obtained and
  progress bar. Note that this option is only available when
  returning a list instead of a generator.
- `seed`: A seed for the random number generator. This can be used to
  obtain reproducible results.

**Returns:**
A generator of [`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects, or a list of
[`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects if `as_list` is set to True.

**Example:**

We construct a polytope and find some random triangulations. The
triangulations are obtained very quickly, but they are not a fair sample
of the space of triangulations. For a fair sample, the
[`random_triangulations_fair`](#random_triangulations_fair) function
should be used.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]]).dual()
g = p.random_triangulations_fast()
next(g) # Runs very quickly
# A fine, regular, star triangulation of a 4-dimensional point configuration with 106 points in ZZ^4
next(g) # Keeps producing triangulations until it has trouble finding more
# A fine, regular, star triangulation of a 4-dimensional point configuration with 106 points in ZZ^4
rand_triangs = p.random_triangulations_fast(N=10, as_list=True) # Produces the list of 10 triangulations very quickly
```

---

### `random_triangulations_gnn`

**Description:**
Constructs random NTFE FR(S)Ts of a reflexive 4D polytope, sampling
the 2-face FRTs with the dualGNN graph neural network
[arXiv:2605.27770](https://arxiv.org/abs/2605.27770) and extending
them via the NTFE algorithm
[arXiv:2309.10855](https://arxiv.org/abs/2309.10855).

This is a thin convenience wrapper around
`ntfe_frts` with `triang_method="dualgnn"`, which
should be used directly when more control is needed (e.g., providing
precomputed face triangulations or a custom GNN checkpoint).

This sampler is much closer to uniform over the set of FRSTs than
[`random_triangulations_fast`](#random_triangulations_fast), while
being far faster than
[`random_triangulations_fair`](#random_triangulations_fair) at large
\(h^{1,1}\).

**NOTE:**

This function requires the optional `dualgnn` package (which depends
on PyTorch). It can be installed with `pip install cytools[gnn]` or
`pip install dualgnn`.

**Arguments:**

- `N`: Number of NTFEs to sample. Since not every combination of
  2-face FRTs glues into an NTFE (acceptance can be ~1% for
  polytopes with large 2-faces, e.g., the h11=86 benchmark of
  arXiv:2605.27770), draws are retried until `N` distinct NTFEs
  are found. Fewer are returned only if the attempt budget
  (1000\*N draws) is exhausted or every combination has been
  checked.
- `make_star`: Whether to convert the NTFE FRTs into FRSTs (i.e., to
  make them star).
- `max_npts`: The maximum number of points of 2-faces for which all
  FRTs are enumerated; the GNN samples FRTs of 2-faces with more
  points. Default 0, i.e., the GNN samples every 2-face:
  enumerating a face's FRTs can be slow even when only a handful
  of triangulations are wanted.
- `N_face_triangs`: Number of FRTs the GNN samples per (large)
  2-face. Every sampled NTFE is assembled from these per-face
  pools, so the pool size sets the support of the sampler:
  small pools restrict (and so bias) which NTFEs can appear,
  while the pool-building step's cost is proportional to the
  pool size. Lower it (e.g., 50) for quick exploratory draws on
  polytopes with large 2-faces; raise it when coverage of the
  NTFE space matters.
- `as_heights`: By default this function returns
  [`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects. This flag can be set
  to True so that it instead returns the height vectors realizing
  each NTFE, which is cheaper when the `Triangulation` objects are
  not needed.
- `as_generator`: Whether to return a generator instead of a list.
  Use generators if memory is a concern.
- `seed`: A seed for the random number generator. This can be used to
  obtain reproducible results.
- `verbosity`: Verbosity level. Higher means more verbose.

**Returns:**
A list of [`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects (or of height
vectors if `as_heights` is set to True), or a generator of them if
`as_generator` is set to True.

**Example:**

We construct a polytope and sample some random triangulations.
(This polytope has a single NTFE, so a single triangulation comes
back no matter `N`.)

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[0,0,0,-1],[-1,-1,-6,-9]])
frsts = p.random_triangulations_gnn(N=4, seed=0)
# [A fine, regular, star triangulation of a 4-dimensional point configuration with 7 points in ZZ^4]
```

For large polytopes, build the GNN-sampled 2-face FRT pools once via
`face_triangs` and reuse them across NTFE
draws. Since only ~1% of the sampled expanded secondary cones may be
solid, request many more than the desired count.

```python
verts = [[-1,-1,-1,-1],[-1,-1,-1,3],[-1,-1,3,-1],[-1,3,-1,-1],
         [ 1,-1,-1,-1],[ 1,-1,-1,3],[ 1,-1,3,-1],[ 1,3,-1,-1]]
p = Polytope(verts) # h11=86
pools = p.face_triangs(dim=2, triang_method="dualgnn", max_npts=0, N_face_triangs=50, seed=0) # the expensive step (~10s)
frsts = p.ntfe_frts(N=300, face_triangs=pools, make_star=True, seed=0) # cheap (~2s)
# [A fine, regular, star triangulation of a 4-dimensional point configuration with 91 points in ZZ^4,
#  A fine, regular, star triangulation of a 4-dimensional point configuration with 91 points in ZZ^4,
#  A fine, regular, star triangulation of a 4-dimensional point configuration with 91 points in ZZ^4]
```

---

### `triangulate`

**Description:**
Returns a single regular triangulation of the polytope.

**NOTE:**

When reflexive polytopes are used, it defaults to returning a fine,
regular, star triangulation.

**Arguments:**

- `include_points_interior_to_facets`: Whether to include points
  interior to facets from the triangulation. If not specified, it is
  set to False for reflexive polytopes and True otherwise.
- `points`: List of point labels that will be used. Note that if this
  option is used then the parameter
  `include_points_interior_to_facets` is ignored.
- `make_star`: Indicates whether to turn the triangulation into a star
  triangulation by deleting internal lines and connecting all points
  to the origin, or equivalently by decreasing the height of the
  origin to be much lower than the rest. By default, this flag is set
  to true if the polytope is reflexive and neither heights or
  simplices are inputted. Otherwise, it is set to False.
- `simplices`: A list of simplices specifying the triangulation. This
  is useful when a triangulation was previously computed and it needs
  to be used again. Note that the order of the points needs to be
  consistent with the order that the `Polytope` class uses.
- `check_input_simplices`: Flag that specifies whether to check if the
  input simplices define a valid triangulation.
- `heights`: The heights specifying the regular triangulation. When not
  specified, construct based off of the backend:

  ```text
    - (CGAL) a Delaunay triangulation,
    - (QHULL) triangulation from random heights near Delaunay, or
    - (TOPCOM) placing triangulation.
  ```

  Heights can only be specified when using CGAL or QHull as the
  backend.
- `check_heights`: Whether to check if the input/default heights define
  a valid/unique triangulation.
- `backend`: The backend used to compute the triangulation. Options are
  "qhull", "cgal", and "topcom". CGAL is the default as it is very
  fast and robust.
- `verbosity`: The verbosity level.

**Returns:**
A [`Triangulation`](https://cy.tools/docs/documentation/triangulation) object describing a triangulation
of the polytope.

**Example:**

We construct a triangulation of a reflexive polytope and check that by
default it is a fine, regular, star triangulation. We also try
constructing triangulations with heights, input simplices, and using
the other backends.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-2,-1,-1],[-2,-1,-1,-1]])
p.triangulate()
# A fine, regular, star triangulation of a 4-dimensional polytope in
# ZZ^4
p.triangulate(heights=[-30,5,5,24,-19,-14,29])
# A fine, regular, star triangulation of a 4-dimensional polytope in
# ZZ^4
p.triangulate(simplices=[[0,1,2,3,4],[0,1,2,3,5],[0,1,2,4,6],[0,1,2,5,6],[0,1,3,4,5],[0,1,4,5,6],[0,2,3,4,5],[0,2,4,5,6]])
# A fine, regular, star triangulation of a 4-dimensional polytope in
# ZZ^4
p.triangulate(backend="qhull")
# A fine, regular, star triangulation of a 4-dimensional polytope in
# ZZ^4
p.triangulate(backend="topcom")
# A fine, regular, star triangulation of a 4-dimensional polytope in
# ZZ^4
```

---

### `vertices`

**Description:**
Returns the vertices of the polytope.

**Arguments:**

- `optimal`: Whether to return the points in their optimal coordinates.
- `as_indices`: Return the points as indices of the full list
  of points of the polytope.

**Returns:**
The list of vertices of the polytope.

**Example:**

We construct a polytope and find its vertices. We can see that they
match the points that we used to construct the polytope.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p.vertices()
# array([[ 1,  0,  0,  0],
#        [ 0,  1,  0,  0],
#        [ 0,  0,  1,  0],
#        [ 0,  0,  0,  1],
#        [-1, -1, -1, -1]])
```

---

### `volume`

**Description:**
Returns the volume of the polytope.

**INFO:**

By convention, the standard simplex has unit volume. To get the more
typical Euclidean volume it must be multiplied by \(d!\).

**Arguments:**
None.

**Returns:**
The volume of the polytope.

**Example:**

We construct a standard simplex and a cube, and find their volumes.

```python
p1 = Polytope([[1,0,0],[0,1,0],[0,0,1],[0,0,0]])
p2 = Polytope([[1,0,0],[0,1,0],[0,0,1],[0,0,0],[0,1,1],[1,0,1],[1,1,0],[1,1,1]])
p1.volume()
# 1
p2.volume()
# 6
```

---

## Hidden Functions

### `__add__`

**Description:**
Implements addition of polytopes with the
[`minkowski_sum`](#minkowski_sum) function.

**Arguments:**

- `other`: The other polytope used for the Minkowski sum.

**Returns:**
The Minkowski sum.

**Example:**

We construct two polytopes and compute their Minkowski sum.

```python
p1 = Polytope([[1,0,0],[0,1,0],[-1,-1,0]])
p2 = Polytope([[0,0,1],[0,0,-1]])
p1 + p2
# A 3-dimensional reflexive lattice polytope in ZZ^3
```

---

### `__eq__`

**Description:**
Implements comparison of polytopes with ==.

**Arguments:**

- `other`: The other polytope that is being compared.

**Returns:**
The truth value of the polytopes being equal.

**Example:**

We construct two polytopes and compare them.

```python
p1 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p2 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p1 == p2
# True
```

---

### `__getstate__`

**Description:**
Gets the state of the class instance, for pickling.

**Arguments:**
None

**Returns:**
Nothing.

---

### `__hash__`

**Description:**
Implements the ability to obtain hash values from polytopes.

**Arguments:**
None.

**Returns:**
The hash value of the polytope.

**Example:**

We compute the hash value of a polytope. Also, we construct a set and a
dictionary with a polytope, which make use of the hash function.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
h = hash(p) # Obtain hash value
d = {p: 1} # Create dictionary with polytope keys
s = {p} # Create a set of polytopes
```

---

### `__init__`

**Description:**
Initializes a `Polytope` object describing a lattice polytope.

**NOTE:**

CYTools only supports lattice polytopes, so any floating point numbers
will be truncated to integers.

**Arguments:**

- `points`: A list of lattice points defining the polytope as their
  convex hull.
- `labels`: A list of labels to specify the points. I.e., points[i] is
  labelled/accessed as labels[i]. If no labels are provided, then the
  points are given semi-arbitrary default labels.
- `backend`: A string that specifies the backend used to construct the
  convex hull. The available options are "ppl", "qhull", or "palp".
  When not specified, it uses PPL for dimensions up to four, and palp
  otherwise.
- `deterministic_glsm_basis`: Whether to fix the GLSM basis in a
  deterministic manner. By setting this True, the GLSM/divisor bases
  should be consistent across different machines. If this is left as
  False, then bases will be computed identically to how they were
  before this flag was added.
  N.B.: the basis chosen under `deterministic_glsm_basis=True` may
  differ from the basis chosen under `deterministic_glsm_basis=False`!

**Returns:**
Nothing.

**Example:**

This is the function that is called when creating a new `Polytope`
object. Thus, it is used in the following example.

```python
from cytools import Polytope
p1 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
print(p1)
# A 4-dimensional reflexive lattice polytope in ZZ^4
p2 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[-1,-1,-1,0]])
print(p2)
# A 3-dimensional lattice polytope in ZZ^4
```

---

### `__ne__`

**Description:**
Implements comparison of polytopes with !=.

**Arguments:**

- `other`: The other polytope that is being compared.

**Returns:**
The truth value of the polytopes being different.

**Example:**

We construct two polytopes and compare them.

```python
p1 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p2 = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
p1 != p2
# False
```

---

### `__repr__`

**Description:**
Returns an unambiguous string describing the polytope.

**Arguments:**
None.

**Returns:**
A string describing the polytope.

**Example:**

This function can be used to convert the polytope to a string or to
print information about the polytope.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
print(repr(p)) # Prints polytope info
# A 4-dimensional reflexive lattice polytope in ZZ^4
```

---

### `__setstate__`

**Description:**
Sets the state of the class instance, for pickling.

**Arguments:**

- `state`: The dictionary of the instance state, read from pickle.

**Returns:**
Nothing.

---

### `__str__`

**Description:**
Returns a human-readable string describing the polytope.

**Arguments:**
None.

**Returns:**
A string describing the polytope.

**Example:**

This function can be used to convert the polytope to a string or to
print information about the polytope.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
poly_info = str(p) # Converts to string
print(p) # Prints polytope info
# A 4-dimensional reflexive lattice polytope in ZZ^4
```

---

### `_dump`

**Description:**
Get every class variable.

No copying is done, so be careful with mutability!

**Arguments:**
None.

**Returns:**
Dictionary mapping variable name to value.

---

### `_faces4d`

**Description:**
Computes the faces of a 4D polytope.

**NOTE:**

This function is a slightly more optimized version of the
[`faces`](#faces) function. Typically the user should not call this
function directly. Instead, it is only called by [`faces`](#faces) when
the polytope is 4-dimensional.

**Arguments:**
None.

**Returns:**
A tuple of tuples of faces organized in ascending dimension.

**Example:**

We construct a 4D polytope and compute its faces. Since this function
generally should not be directly used, we do this with the
[`faces`](#faces) function.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
allfaces = p.faces() # the _faces4d function is used since it is a 4d polytope
print(allfaces[1][0]) # Print the first face in the tuple of 1-dimensional faces
# A 1-dimensional face of a 4-dimensional polytope in ZZ^4
```

---

### `_optimal_to_input`

**Description:**
We internally store the points in an 'optimal' representation
(translated, LLL-reduced, ...). This eases computations. We will
always want to return answers in original representation. This
function performs the mapping.

This is a kind of costly map so, whenever possible, use
\_optimalpts2labels
and
\_labels2inputPts

**Arguments:**

- `pts_opt`: The points in the optimal representation.

**Returns:**
The points in the original representation.

---

### `_process_points`

**Description:**
Internal function for processing input points. Should only be called
once (in the initializer). Abstracted here to clarify logic.

Sets:
self.\_transl\_vector
self.\_transf\_mat\_inv
self.\_poly\_optimal
self.\_ineqs\_optimal
self.\_labels2optPts
self.\_labels2inputPts
self.\_pts\_saturating
self.\_pts\_order
self.\_inputpts2labels
self.\_optimalpts2labels
self.\_labels2inds
self.\_label\_origin
self.\_labels\_int
self.\_labels\_facet
self.\_labels\_bdry
self.\_labels\_codim2
self.\_labels\_not\_facet

**Arguments:**

- `pts_input`: The points input from the user.
- `labels`: The point labels input from the user.

**Returns:**
Nothing.

---

### `_triang_labels`

**Description:**
Constructs the list of point labels of the points that will be used in
a triangulation.

**NOTE:**

Typically this function should not be called by the user. Instead, it
is called by various other functions in the Polytope class.

**Arguments:**

- `include_points_interior_to_facets`: Whether to include points
  interior to facets from the triangulation. If not specified, it is
  set to False for reflexive polytopes and True otherwise.

**Returns:**
A tuple of the indices of the points that will be included in a
triangulation

**Example:**

We construct triangulations in various ways. We use the
[`triangulate`](#triangulate) function instead of using this function
directly.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t1 = p.triangulate()
print(t1)
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
t2 = p.triangulate(include_points_interior_to_facets=True)
print(t2)
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 10 points in ZZ^4
t3 = p.triangulate(points=[1,2,3,4,5])
print(t3)
# A fine, regular, non-star triangulation of a 4-dimensional point
# configuration with 5 points in ZZ^4
```

---

---

# PolytopeFace Class

Source: https://cy.tools/docs/documentation/polytopeface

This class handles all computations relating to faces of lattice polytopes.

**INFO:**

Generally, objects of this class should not be constructed directly by the
user. Instead, they should be created by the [`faces`](https://cy.tools/docs/documentation/polytope#faces)
function of the [`Polytope`](https://cy.tools/docs/documentation/polytope) class.

## Constructor

### `cytools.polytopeface.PolytopeFace`

**Description:**
Constructs a `PolytopeFace` object describing a face of a lattice polytope.
This is handled by the hidden [`__init__`](#__init__) function.

**Arguments:**

- `ambient_poly` *(Polytope)*: The ambient polytope.
- `vertices` *(array\_like)*: The list of vertices.
- `saturated_ineqs` *(frozenset)*: A frozenset containing the indices of
  the inequalities that this face saturates.
- `dim` *(int, optional)*: The dimension of the face. If it is not given
  then it is computed.

**Example:**

Since objects of this class should not be directly created by the end user,
we demonstrate how to construct these objects using the
[`faces`](https://cy.tools/docs/documentation/polytope#faces) function of the [`Polytope`](https://cy.tools/docs/documentation/polytope) class.

```python
from cytools import Polytope
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
faces_3 = p.faces(3) # Find the 3-dimensional faces
print(faces_3[0]) # Print the first 3-face
# A 3-dimensional face of a 4-dimensional polytope in ZZ^4
```

---

## Functions

### `ambient_dimension`

**Description:**
Returns the dimension of the ambient lattice.

**Arguments:**
None.

**Returns:**
The dimension of the ambient lattice.

**Aliases:**
`ambient_dim`.

---

### `ambient_poly`

**Description:**
Returns the ambient polytope.

**Arguments:**
None.

**Returns:**
The ambient polytope.

---

### `as_polytope`

**Description:**
Returns the face as a Polytope object.

**Arguments:**
None.

**Returns:**
The [`Polytope`](https://cy.tools/docs/documentation/polytope) corresponding to the face.

**Example:**

We construct a face object and then convert it into a
[`Polytope`](https://cy.tools/docs/documentation/polytope) object.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(3)[0] # Pick one of the 3-faces
f_poly = f.as_polytope()
print(f_poly)
# A 3-dimensional lattice polytope in ZZ^4
```

---

### `boundary_points`

**Description:**
Returns the boundary lattice points of the face.

**Arguments:**

- `as_indices`: Return the points as indices of the full list of
  points of the polytope.

**Returns:**
The list of boundary lattice points of the face.

**Aliases:**
`boundary_pts`.

**Example:**

We construct a face object and find its boundary lattice points.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(3)[0] # Pick one of the 3-faces
f.boundary_points()
# array([[-1, -1, -1, -1],
#        [ 0,  0,  0,  1],
#        [ 0,  0,  1,  0],
#        [ 0,  1,  0,  0]])
```

---

### `clear_cache`

**Description:**
Clears the cached results of any previous computation.

**Arguments:**
None.

**Returns:**
Nothing.

**Example:**

We construct a face object and find its lattice points, then we clear
the cache and compute the points again.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(3)[0] # Pick one of the 3-faces
pts = f.points() # Find the lattice points
f.clear_cache() # Clears the results of any previous computation
pts = f.points() # Find the lattice points again
```

---

### `dimension`

**Description:**
Returns the dimension of the face.

**Arguments:**
None.

**Returns:**
*(int)* The dimension of the face.

**Aliases:**
`dim`.

---

### `dual_face`

**Description:**
Returns the dual face of the dual polytope.

**NOTE:**

This duality is only implemented for reflexive polytopes. An exception
is raised if the polytope is not reflexive.

**Arguments:**
None.

**Returns:**
The dual face.

**Aliases:**
`dual`.

**Example:**

We construct a face object from a polytope, then find the dual face in
the dual polytope.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(2)[0] # Pick one of the 2-faces
f_dual = f.dual_face()
print(f_dual)
# A 1-dimensional face of a 4-dimensional polytope in ZZ^4
```

---

### `faces`

**Description:**
Computes the faces of the face.

**Arguments:**

- `d`: Optional parameter that specifies the dimension of the desired
  faces.

**Returns:**
A tuple of [`PolytopeFace`](https://cy.tools/docs/documentation/polytopeface) objects of dimension d, if
specified. Otherwise, a tuple of tuples of
[`PolytopeFace`](https://cy.tools/docs/documentation/polytopeface) objects organized in ascending
dimension.

**Example:**

We construct a face from a polytope and find its vertices.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(3)[0] # Pick one of the 3-faces
print(f.faces(2)[0]) # Print one of its 2-faces
# A 2-dimensional face of a 4-dimensional polytope in ZZ^4
```

---

### `interior_points`

**Description:**
Returns the interior lattice points of the face.

**Arguments:**

- `as_indices`: Return the points as indices of the full list of
  points of the polytope.

**Returns:**
The list of interior lattice points of the face.

**Aliases:**
`interior_pts`.

**Example:**

We construct a face object and find its interior lattice points.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
f = p.faces(3)[2] # Pick one of the 3-faces
f.interior_points()
# array([[ 0,  0, -1, -2],
#        [ 0,  0,  0, -1]])
```

---

### `labels`

**Description:**
Returns the labels of lattice points in the face.

**Arguments:**
None.

**Returns:**
The labels of lattice points in the face.

---

### `labels_bdry`

**Description:**
Returns the labels of boundary lattice points in the face.

**Arguments:**
None.

**Returns:**
The labels of boundary lattice points in the face.

---

### `labels_int`

**Description:**
Returns the labels of interior lattice points in the face.

**Arguments:**
None.

**Returns:**
The labels of interior lattice points in the face.

---

### `labels_vertices`

**Description:**
Returns the labels of vertices in the face.

**Arguments:**
None.

**Returns:**
The labels of vertices in the face.

---

### `points`

**Description:**
Returns the lattice points of the face.

**Arguments:**

- `as_indices`: Return the points as indices of the full list of
  points of the polytope.

**Returns:**
*(numpy.ndarray)* The list of lattice points of the face.

**Aliases:**
`pts`.

**Example:**

We construct a face object and find its lattice points.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(3)[0] # Pick one of the 3-faces
f.points()
# array([[-1, -1, -1, -1],
#        [ 0,  0,  0,  1],
#        [ 0,  0,  1,  0],
#        [ 0,  1,  0,  0]])
```

---

### `triangulate`

**Description:**
Returns a single regular triangulation of the face.

Just a simple wrapper for the Triangulation constructor.

Also see Polytope.triangulate

**Arguments:**

- `heights`: A list of heights specifying the regular triangulation.
  When not specified, it will return the Delaunay triangulation when
  using CGAL, a triangulation obtained from random heights near the
  Delaunay when using QHull, or the placing triangulation when using
  TOPCOM. Heights can only be specified when using CGAL or QHull as
  the backend.
- `simplices`: A list of simplices specifying the triangulation. This
  is useful when a triangulation was previously computed and it
  needs to be used again. Note that the order of the points needs to
  be consistent with the order that the `Polytope` class uses.
- `check_input_simplices`: Flag that specifies whether to check if the
  input simplices define a valid triangulation.
- `backend`: Specifies the backend used to compute the triangulation.
  The available options are "qhull", "cgal", and "topcom". CGAL is
  the default one as it is very fast and robust.
- `verbosity`: The verbosity level.

**Returns:**
A [`Triangulation`](https://cy.tools/docs/documentation/triangulation) object describing a triangulation
of the polytope.

---

### `vertices`

**Description:**
Returns the vertices of the face.

**Arguments:**

- `as_indices` *(bool, optional, default=False)*: Whether to return
  the vertices as indices instead of coordinates.

**Returns:**
The list of vertices of the face.

**Example:**

We construct a face from a polytope and find its vertices.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(2)[0] # Pick one of the 2-faces
f.vertices()
# array([[-1, -1, -1, -1],
#        [ 0,  0,  0,  1],
#        [ 0,  0,  1,  0]])
```

---

## Hidden Functions

### `__init__`

**Description:**
Initializes a `PolytopeFace` object.

**Arguments:**

- `ambient_poly`: The ambient polytope.
- `vert_labels`: The vertices, specified by labels in ambient\_poly.
- `saturated_ineqs`: Indices of inequalities that this face saturates.
- `dim`: The dimension of this face. If not given, then it's computed.

**Returns:**
Nothing.

**Example:**

This is the function that is called when creating a new
`PolytopeFace` object. Thus, it is used in the following example.

```python
from cytools import Polytope
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
faces_3 = p.faces(3) # Find the 3-dimensional faces
print(faces_3[0]) # Print the first 3-face
# A 3-dimensional face of a 4-dimensional polytope in ZZ^4
```

---

### `__repr__`

**Description:**
Returns a string describing the face.

**Arguments:**
None.

**Returns:**
*(str)* A string describing the face.

**Example:**

This function can be used to convert the face to a string or to print
information about the face.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
f = p.faces(3)[0]
face_info = str(f) # Converts to string
print(f) # Prints face info
```

---

### `_process_points`

**Description:**
Grabs the labels of the lattice points of the face along with the
indices of the hyperplane inequalities that they saturate.

**Arguments:**
None.

**Returns:**
Nothing.

---

---

# Triangulation Class

Source: https://cy.tools/docs/documentation/triangulation

This class handles triangulations of lattice polytopes. It can compute
various properties of the triangulation, as well as construct a
ToricVariety or CalabiYau object if the triangulation is suitable.

**INFO:**

Generally, objects of this class should not be constructed directly by the
end user. Instead, they should be created by various functions of the
[`Polytope`](https://cy.tools/docs/documentation/polytope) class.

## Constructor

### `cytools.triangulation.Triangulation`

**Description:**
Constructs a `Triangulation` object describing a triangulation of a lattice
polytope. This is handled by the hidden [`__init__`](#__init__) function.

**NOTE:**

If you construct a triangulation object directly by inputting a list of
points they may be reordered to match the ordering of the points from the
[`Polytope`](https://cy.tools/docs/documentation/polytope) class. This is to ensure that computations of
toric varieties and Calabi-Yau manifolds are correct. To avoid this
subtlety we discourage users from constructing Triangulation objects
directly, and instead use the triangulation functions in the
[`Polytope`](https://cy.tools/docs/documentation/polytope) class.

**Arguments:**

- `poly`: The ambient polytope of the points to be triangulated. If not
  specified, it's constructed as the convex hull of the given points.
- `pts`: The list of points to be triangulated. Specified by labels.
- `heights`: The heights specifying the regular triangulation. When not
  specified, construct based off of the backend:

  ```text
    - (CGAL) Delaunay triangulation,
    - (QHULL) triangulation from random heights near Delaunay, or
    - (TOPCOM) placing triangulation.
  ```

  Heights can only be specified when using CGAL or QHull as the backend.
- `make_star`: Whether to turn the triangulation into a star triangulation
  by deleting internal lines and connecting all points to the origin, or
  equivalently, by decreasing the height of the origin until it is much
  lower than all other heights.
- `simplices`: Array-like of simplices specifying the triangulation. Each
  simplex is a list of point labels. This is useful when a triangulation
  was previously computed and it needs to be used again. Note that the
  ordering of the points needs to be consistent.
- `check_input_simplices`: Whether to check if the input simplices define a
  valid triangulation.
- `backend`: The backend used to compute the triangulation. Options are
  "qhull", "cgal", and "topcom". CGAL is the default as it is very
  fast and robust.
- `verbosity`: The verbosity level.

**Example:**

We construct a triangulation of a polytope. Since this class is not
intended to by initialized by the end user, we create it via the
[`triangulate`](https://cy.tools/docs/documentation/polytope#triangulate) function of the
[`Polytope`](https://cy.tools/docs/documentation/polytope) class. In this example the polytope is reflexive,
so by default the triangulation is fine, regular, and star. Also, since the
polytope is reflexive then by default only the lattice points not interior
to facets are included in the triangulation.

```python
from cytools import Polytope
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
print(t)
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
```

---

## Functions

### `ambient_dimension`

**Description:**
Returns the dimension of the ambient lattice.

**Arguments:**
None.

**Returns:**
The dimension of the ambient lattice.

**Aliases:**
`ambient_dim`.

**Example:**

We construct a triangulation and find its ambient dimension.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.ambient_dim()
# 4
```

---

### `automorphism_orbit`

**Description:**
Returns all of the triangulations of the polytope that can be obtained
by applying one or more polytope automorphisms to the triangulation.

It also has the option of restricting the simplices to faces of the
polytope of a particular dimension or codimension. This restriction is
useful for checking CY equivalences from different triangulations.

**NOTE:**

Depending on how the point configuration was constructed, it may be the
case that the automorphism group of the point configuration is larger
or smaller than the one from the polytope. This function only uses the
subset of automorphisms of the polytope that are also automorphisms of
the point configuration.

**Arguments:**

- `automorphism`: The index or list of indices of the polytope
  automorphisms to use. If not specified it uses all automorphisms.
- `on_faces_dim`: Restrict the simplices to faces of the polytope of a
  given dimension.
- `on_faces_codim`: Restrict the simplices to faces of the polytope of
  a given codimension.

**Returns:**
The list of triangulations obtained by performing automorphisms
transformations.

**Example:**

We construct a triangulation and find some of its automorphism orbits.

```python
p = Polytope([[-1,0,0,0],[-1,1,0,0],[-1,0,1,0],[2,-1,0,-1],[2,0,-1,-1],[2,-1,-1,-1],[-1,0,0,1],[-1,1,0,1],[-1,0,1,1]])
t = p.triangulate()
orbit_all_autos = t.automorphism_orbit()
print(len(orbit_all_autos))
# 36
orbit_all_autos_2faces = t.automorphism_orbit(on_faces_dim=2)
print(len(orbit_all_autos_2faces))
# 36
orbit_sixth_auto = t.automorphism_orbit(automorphism=5)
print(len(orbit_sixth_auto))
# 2
orbit_list_autos = t.automorphism_orbit(automorphism=[5,6,9])
print(len(orbit_list_autos))
# 12
```

---

### `check_heights`

**Description:**
Check if the heights uniquely define a triangulation. That is, if they
do not lie on a wall of the generated secondary cone.

If heights don't uniquely correspond to a triangulation, delete the
heights so they are re-calculated (keep triangulation, though...)

**Arguments:**

- `verbosity`: The verbosity level.

**Returns:**
*(bool)* True if the heights uniquely define the triangulation, False
if they are within eps of a wall of the secondary cone.

---

### `clear_cache`

**Description:**
Clears the cached results of any previous computation.

**Arguments:**

- `recursive`: Whether to also clear the cache of the ambient polytope.

**Returns:**
Nothing.

**Example:**

We construct a triangulation, compute its GKZ vector, clear the cache
and then compute it again.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
gkz_phi = t.gkz_phi() # Computes the GKZ vector
t.clear_cache()
gkz_phi = t.gkz_phi() # The GKZ vector is recomputed
```

---

### `dimension`

**Description:**
Returns the dimension of the triangulated point configuration.

**Arguments:**
None.

**Returns:**
The dimension of the triangulation.

**Aliases:**
`dim`.

**Example:**

We construct a triangulation and find its dimension.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.dimension()
# 4
```

---

### `get_cy`

**Description:**
Returns a CalabiYau object corresponding to the anti-canonical
hypersurface on the toric variety defined by the fine, star, regular
triangulation. If a nef-partition is specified then it returns the
complete intersection Calabi-Yau that it specifies.

**NOTE:**

Only Calabi-Yau 3-fold hypersurfaces are fully supported. Other
dimensions and CICYs require enabling the experimental features of
CYTools. See [experimental features](https://cy.tools/docs/documentation/experimental) for more details.

**Arguments:**

- `nef_partition`: A list of tuples of indices specifying a
  nef-partition of the polytope, which correspondingly defines a
  complete intersection Calabi-Yau.

**Returns:**
The Calabi-Yau arising from the triangulation.

**Example:**

We construct a triangulation and obtain the Calabi-Yau hypersurface in
the resulting toric variety.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
t.get_cy()
# A Calabi-Yau 3-fold hypersurface with h11=2 and h21=272 in a 4-dimensional toric variety
```

---

### `get_toric_variety`

**Description:**
Returns a ToricVariety object corresponding to the fan defined by the
triangulation.

**Arguments:**
None.

**Returns:**
The toric variety arising from the triangulation.

**Example:**

We construct a triangulation and obtain the resulting toric variety.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
t.get_toric_variety()
# A simplicial compact 4-dimensional toric variety with 9 affine patches
```

---

### `gkz_phi`

## r

### `heights`

**Description:**
Returns a height vector if the triangulation is regular. An
exception is raised if a height vector could not be found either
because the optimizer failed or because the triangulation is not
regular.

**Arguments:**

- `integral`: Whether to find an integral height vector.
- `backend`: The optimizer used for the computation. The available
  options are the backends of the
  [`find_interior_point`](https://cy.tools/docs/documentation/cone#find_interior_point) function of the
  [`Cone`](https://cy.tools/docs/documentation/cone) class. If not specified, it will be picked
  automatically.

**Returns:**
A height vector giving rise to the triangulation.

**Example:**

We construct a triangulation and find a height vector that generates it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.heights()
# array([0., 0., 0., 0., 0., 1.])
```

---

### `is_equivalent`

**Description:**
Compares two triangulations with or without allowing automorphism
transformations and with the option of restricting to faces of a
particular dimension.

**Arguments:**

- `other`: The other triangulation that is being compared.
- `use_automorphisms`: Whether to check the equivalence using
  automorphism transformations. This flag is ignored for point
  configurations that are not full dimensional.
- `on_faces_dim`: Restrict the simplices to faces of the polytope of a
  given dimension.
- `on_faces_codim`: Restrict the simplices to faces of the polytope of
  a given codimension.

**Returns:**
The truth value of the triangulations being equivalent under the
specified parameters.

**Example:**

We construct two triangulations and check whether they are equivalent
under various conditions.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[-1,1,1,0],[0,-1,-1,0],[0,0,0,1],[1,-2,1,1],[-2,2,1,-1],[1,1,-1,-1]])
triangs_gen = p.all_triangulations()
t1 = next(triangs_gen)
t2 = next(triangs_gen)
t1.is_equivalent(t2)
# False
t1.is_equivalent(t2, on_faces_dim=2)
# True
t1.is_equivalent(t2, on_faces_dim=2, use_automorphisms=False)
# True
```

---

### `is_fine`

**Description:**
Returns True if the triangulation is fine (all the points are used), and
False otherwise. Note that this only checks if it is fine with respect
to the point configuration, not with respect to the full set of lattice
points of the polytope.

**Arguments:**
None.

**Returns:**
The truth value of the triangulation being fine.

**Example:**

We construct a triangulation and check if it is fine.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.is_fine()
# True
```

---

### `is_regular`

**Description:**
Returns True if the triangulation is regular and False otherwise.

**Arguments:**

- `backend`: The optimizer used for the computation. The available
  options are the backends of the [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid)
  function of the [`Cone`](https://cy.tools/docs/documentation/cone) class. If not specified, it will
  be picked automatically.

**Returns:**
The truth value of the triangulation being regular.

**Example:**

We construct a triangulation and check if it is regular.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.is_regular()
# True
```

---

### `is_star`

**Description:**
Returns True if the triangulation is star and False otherwise. The star
origin is assumed to be the origin, so for polytopes that don't contain
the origin this function will always return False unless `star_origin`
is specified.

**Arguments:**

- `star_origin`: The index of the origin of the star triangulation

**Returns:**
The truth value of the triangulation being star.

**Example:**

We construct a triangulation and check if it is star.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.is_star()
# True
```

---

### `is_valid`

**Description:**
Returns True if the presumed triangulation meets all requirements to be
a triangulation. The simplices must cover the full volume of the convex
hull, and they cannot intersect at full-dimensional regions.

**Arguments:**

- `backend`: The optimizer used for the computation. The available
  options are the backends of the [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid)
  function of the [`Cone`](https://cy.tools/docs/documentation/cone) class. If not specified, it will
  be picked automatically.
- `verbosity`: The verbosity level.

**Returns:**
The truth value of the triangulation being valid.

**Example:**

This function is useful when constructing a triangulation from a given
set of simplices. We show this in this example.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate(simplices=[[0,1,2,3,4],[0,1,2,3,5],[0,1,2,4,5],[0,1,3,4,5],[0,2,3,4,5]]) # It is already used here unless using check_input_simplices=False
t.is_valid()
# True
```

---

### `labels`

**Description:**
Returns the labels of lattice points in the triangulation.

**Arguments:**
None.

**Returns:**
The labels of lattice points in the triangulation.

---

### `neighbor_triangulations`

**Description:**
Returns the list of triangulations that differ by one bistellar flip
from the current triangulation. The computation is performed with a
modified version of TOPCOM. There is the option of limiting the flips
to fine, regular, and star triangulations. An additional backend is
used to check regularity, as checking this with TOPCOM is very slow for
large polytopes.

**Arguments:**

- `only_fine`: Restricts to fine triangulations.
- `only_regular`: Restricts the to regular triangulations.
- `only_star`: Restricts to star triangulations.
- `two_neighbors`: Return the 2-neighbors. FRSTs with the same 2-face
  restriction give equivalent CYs. An FRST is a representative of an
  equivalence class. The 2-neighbors are the equivalence classes
  differing by a single flip of a 2-face. Just return a representative
  from each class. This gives the neighboring CYs more directly.
- `two_neighbors_track_flips`: Only valid with `two_neighbors`. If True,
  return `(triangulation, face_index, circuit)` triples instead of bare
  (triangulation,). `face_index` indexes `polytope.faces(2)` and
  `circuit` is the sorted tuple of the four point labels spanning the
  flipped quadrilateral.
- `backend`: The backend used to check regularity. The options are any
  backend available for the [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid) function of
  the [`Cone`](https://cy.tools/docs/documentation/cone) class. If not specified, it will be picked
  automatically.
- `verbose`: Whether to print extra info from the TOPCOM command.

**Returns:**
The list of triangulations that differ by one bistellar flip from the
current triangulation, or `(triangulation, face_index, circuit)` triples
if `two_neighbors & two_neighbors_track_flips`.

**Example:**

We construct a triangulation and find its neighbor triangulations.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]]).dual()
t = p.triangulate()
triangs = t.neighbor_triangulations()
len(triangs) # Print how many triangulations it found
# 263
```

---

### `points`

**Description:**
Returns the points of the triangulation. Note that these are not
necessarily equal to the lattice points of the polytope they define.

**Arguments:**

- `which`: Which points to return. Specified by a (list of) labels.
  NOT INDICES!!!
- `optimal`: Whether to return the points in their optimal coordinates.
- `as_indices`: Return the points as indices of the full list of points
  of the polytope.

**Returns:**
The points of the triangulation.

**Aliases:**
`pts`.

**Example:**

We construct a triangulation and print the points in the point
configuration. Note that since the polytope is reflexive, then by
default only the lattice points not interior to facets were used.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
t.points()
# array([[ 0,  0,  0,  0],
#        [-1, -1, -6, -9],
#        [ 0,  0,  0,  1],
#        [ 0,  0,  1,  0],
#        [ 0,  1,  0,  0],
#        [ 1,  0,  0,  0],
#        [ 0,  0, -2, -3]])
```

---

### `points_to_indices`

**Description:**
Returns the list of indices corresponding to the given points. It also
accepts a single point, in which case it returns the corresponding
index.

**Arguments:**

- `points`: A point or a list of points.
- `is_optimal`: Whether the points argument represents points in the
  optimal (True) or input (False) basis

**Returns:**
The list of indices corresponding to the given points, or the index of
the point if only one is given.

**Example:**

We construct a polytope and find the indices of some of its points.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.points_to_indices([-1,-1,-6,-9]) # We input a single point, so a single index is returned
# 1
p.points_to_indices([[-1,-1,-6,-9],[0,0,0,0],[0,0,1,0]]) # We input a list of points, so a list of indices is returned
# array([1, 0, 3])
```

---

### `points_to_labels`

**Description:**
Returns the list of labels corresponding to the given points. It also
accepts a single point, in which case it returns the corresponding
label.

**Arguments:**

- `points`: A point or a list of points.
- `is_optimal`: Whether the points argument represents points in the
  optimal (True) or input (False) basis

**Returns:**
The list of labels corresponding to the given points, or the label of
the point if only one is given.

---

### `poly`

**Description:**
Returns the polytope being triangulated.

**Arguments:**
None.

**Returns:**
The ambient polytope.

---

### `random_flips`

**Description:**
Returns a triangulation obtained by performing N random bistellar
flips. The computation is performed with a modified version of TOPCOM.
There is the option of limiting the flips to fine, regular, and star
triangulations. An additional backend is used to check regularity, as
checking this with TOPCOM is very slow for large polytopes.

**Arguments:**

- `N`: The number of bistellar flips to perform.
- `only_fine`: Restricts to flips to fine triangulations. If not
  specified, it is set to True if the triangulation is fine, and
  False otherwise.
- `only_regular`: Restricts the flips to regular triangulations. If not
  specified, it is set to True if the triangulation is regular, and
  False otherwise.
- `only_star`: Restricts the flips to star triangulations. If not
  specified, it is set to True if the triangulation is star, and
  False otherwise.
- `backend`: The backend used to check regularity. The options are any
  backend available for the [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid) function of
  the [`Cone`](https://cy.tools/docs/documentation/cone) class. If not specified, it will be picked
  automatically.
- `seed`: A seed for the random number generator. This can be used to
  obtain reproducible results.

**Returns:**
A new triangulation obtained by performing N random flips.

**Example:**

We construct a triangulation and perform 5 random flips to find a new
triangulation.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]]).dual()
t = p.triangulate()
t.random_flips(5) # Takes a few seconds
# A fine, star triangulation of a 4-dimensional point configuration
# with 106 points in ZZ^4
```

---

### `restrict`

**Description:**
Restrict the triangulation to some face(s).

**Arguments:**

- `restrict_to`: The face(s) to restrict to. If none provided, gives
  restriction to each dim-face (see next argument).
- `restrict_dim`: If restrict\_to is None, sets the dimension of the
  faces to restrict to.  ***Only used if restrict\_to == None.***
- `as_poly`: Construct the formal Triangulation objects.
- `verbosity`: The verbosity level.

**Returns:**
The restrictions

---

### `secondary_cone`

**Description:**
Computes the (hyperplanes defining the) secondary cone of the
triangulation. This cone is also called the 'cone of strictly convex
piecewise linear functions'.

The triangulation is regular if and only if this cone is solid (i.e.
full-dimensional), in which case the points in the strict interior
correspond to heights that give rise to the triangulation.

Also, allow calculation of the 'secondary cone of the N-skeleton'. This
cone is defined as
1) the intersection of the secondary cones of all N-dim faces of
this triangulation or, equivalently,
2) the union of all secondary cones arising from triangulations
with the same N-face restrictions.
Any point in the strict interior of this cone correspond to heights
which generate a triangulation with the imposed N-face restrictions.
Set N via argument `on_faces_dim`.

Some cases of interest:
1) N=self.dim() -> return the secondary cone of the triangulation
2) N=2 -> return the union of all secondary cones arising
from triangulations with the same 2-face
restrictions. Akin to Kcup.

**Arguments:**

- `backend`: The backend to use. Options are "native", which uses a
  native implementation of an algorithm by Berglund, Katz and Klemm,
  or "topcom" which uses differences of GKZ vectors.computation.
- `include_points_not_in_triangulation`: This flag allows the exclusion
  of points that are not part of the triangulation. This can be done
  to check regularity faster, but this cannot be used if the actual
  cone in the secondary fan is needed.
- `as_cone`: Return a cone or just the defining hyperplanes.
- `on_faces_dim`: Compute the secondary cone for each face with this
  dimension and then take their intersection. This has the
  interpretation of enforcing the triangulations on each of these
  faces, but being agnostic to the rest of the structure.
- `use_cache`: Whether to use cached values of the secondary cone.

**Returns:**
The secondary cone.

**Aliases:**
`cpl_cone`.

**Example:**

We construct a triangulation and find its secondary cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
t.secondary_cone()
# A rational polyhedral cone in RR^7 defined by 3 hyperplanes normals
```

---

### `simplices`

**Description:**
Returns the simplices of the triangulation. It also has the option of
restricting the simplices to faces of the polytope of a particular
dimension or codimension. This restriction is useful for checking CY
equivalences from different triangulations.

**Arguments:**

- `on\_faces\_dim: Restrict the simplices to faces of the polytope of a
  given dimension.
- `on_faces_codim`: Restrict the simplices to faces of the polytope of
  a given codimension.
- `split_by_face`: Return the simplices for each face. Don't merge the
  collection.
- `as_np_array`: Return the simplices as a numpy array. Otherwise,
  they are returned as a set of frozensets.
- `as_indices`: Whether to map the simplices from labels to point
  indices (in the triangulations).

**Returns:**
The simplices of the triangulation.

**Example:**

We construct a triangulation and find its simplices. We also find the
simplices the lie on 2-faces of the polytope.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
t.simplices()
# array([[0, 1, 2, 3, 4],
#        [0, 1, 2, 3, 5],
#        [0, 1, 2, 4, 5],
#        [0, 1, 3, 4, 5],
#        [0, 2, 3, 4, 5]])
t.simplices(on_faces_dim=2)
# [[1 2 3]
#  [1 2 4]
#  [1 2 5]
#  [1 3 4]
#  [1 3 5]
#  [1 4 5]
#  [2 3 4]
#  [2 3 5]
#  [2 4 5]
#  [3 4 5]]
```

---

### `sr_ideal`

**Description:**
Returns the Stanley-Reisner ideal if the triangulation is star.

That is, find all sets of points which are not subsets of any simplex.
The SR-ideal is generated by such subsets.

N.B.: This function returns the *generators* of the ideal. I.e., we
don't return multiples of the generators.

E.g., take the simplicial complex
[[1,2,3],[1,2,4],[2,3,4],[1,2,5]]
It has the following sets of points not appearing together
(3,5), (4,5), (1,3,4),(1,3,5),(1,4,5), (2,3,5), (2,4,5), (3,4,5)
So, the SR ideal is generated by
x3x5, x4x5, x1x3x4
Don't include things like x2x3x5 since it is a multiple of x3x5.

**Arguments:**
None.

**Returns:**
The Stanley-Reisner ideal of the triangulation.

**Example:**

We construct a triangulation and find its SR ideal.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
t.sr_ideal()
# array([[1, 4, 5],
#        [2, 3, 6]])
```

---

### `triangulation_to_polytope_indices`

**Description:**
Takes a list of indices of points of the triangulation and it returns
the corresponding indices of the polytope. It also accepts a single
entry, in which case it returns the corresponding index.

**Arguments:**

- `points`: A list of indices of points.

**Returns:**
The list of indices corresponding to the given points. Or the index of
the point if only one is given.

---

## Hidden Functions

### `__eq__`

**Description:**
Implements comparison of triangulations with ==.

**Arguments:**

- `other`: The other triangulation that is being compared.

**Returns:**
The truth value of the triangulations being equal.

**Example:**

We construct two triangulations and compare them.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t1 = p.triangulate(backend="qhull")
t2 = p.triangulate(backend="topcom")
t1 == t2
# True
```

---

### `__hash__`

**Description:**
Implements the ability to obtain hash values from triangulations.

**Arguments:**
None.

**Returns:**
The hash value of the triangulation.

**Example:**

We compute the hash value of a triangulation. Also, we construct a set
and a dictionary with a triangulation, which make use of the hash
function.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
h = hash(t) # Obtain hash value
d = {t: 1} # Create dictionary with triangulation keys
s = {t} # Create a set of triangulations
```

---

### `__init__`

**Description:**
Initializes a `Triangulation` object.

**Arguments:**

- `poly`: The ambient polytope of the points to be triangulated.
- `pts`: The list of points to be triangulated. Specified by labels.
- `make_star`: Whether to turn the triangulation into a star
  triangulation by deleting internal lines and connecting all points
  to the origin, or equivalently, by decreasing the height of the
  origin until it is much lower than all other heights.
- `simplices`: Array-like of simplices specifying the triangulation.
  Each simplex is a list of point labels. This is useful when a
  triangulation was previously computed and it needs to be used
  again. Note that the ordering of the points needs to be consistent.
- `check_input_simplices`: Whether to check if the input simplices
  define a valid triangulation.
- `heights`: The heights specifying the regular triangulation. When not
  specified, construct based off of the backend:

  ```text
    - (CGAL) a Delaunay triangulation,
    - (QHULL) triangulation from random heights near Delaunay, or
    - (TOPCOM) placing triangulation.
  ```

  Heights can only be specified when using CGAL or QHull as the
  backend.
- `check_heights`: Whether to check if the input/default heights define
  a valid/unique triangulation.
- `backend`: The backend used to compute the triangulation. Options are
  "qhull", "cgal", and "topcom". CGAL is the default as it is very
  fast and robust.
- `verbosity`: The verbosity level.

**Returns:**
Nothing.

**Example:**

This is the function that is called when creating a new
`Triangulation` object. In this example the polytope is reflexive, so
by default the triangulation is fine, regular, and star. Also, since
the polytope is reflexive then by default only the lattice points not
interior to facets are included in the triangulation.

```python
from cytools import Polytope
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
print(t)
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
```

---

### `__ne__`

**Description:**
Implements comparison of triangulations with !=.

**Arguments:**

- `other`: The other triangulation that is being compared.

**Returns:**
The truth value of the triangulations being different.

**Example:**

We construct two triangulations and compare them.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t1 = p.triangulate(backend="qhull")
t2 = p.triangulate(backend="topcom")
t1 != t2
# False
```

---

### `__repr__`

**Description:**
Returns a string describing the triangulation.

**Arguments:**
None.

**Returns:**
A string describing the triangulation.

**Example:**

This function can be used to convert the triangulation to a string or
to print information about the triangulation.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
poly_info = str(t) # Converts to string
print(t) # Prints triangulation info
# A fine, regular, star triangulation of a 4-dimensional point configuration with 7 points in ZZ^4
```

---

### `_dump`

**Description:**
Get every class variable.

No copying is done, so be careful with mutability!

**Arguments:**
None.

**Returns:**
Dictionary mapping variable name to value.

---

### `_fine_neighbors_2d`

**Description:**
An optimized variant of neighbor\_triangulations for triangulations that
are:
1) 2D (in dimension... ambient dimension doesn't matter)
2) fine
3) fine neighbors are desired
In this case, \_fine\_neighbors\_2d runs much quicker than the
corresponding TOPCOM calculation

**Arguments:**

- `only_regular`: Restricts the to regular triangulations.
- `backend`: The backend used to check regularity. The options are any
  backend available for the [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid) function of
  the [`Cone`](https://cy.tools/docs/documentation/cone) class. If not specified, it will be picked
  automatically.

**Returns:**
The list of triangulations that differ by one diagonal flip from the
current triangulation.

---

### `_two_neighbors`

**Description:**
Returns the "2-neighbors": the FRSTs reachable by a single 2D diagonal
flip of one 2-face, extended back to a full triangulation via NTFE
(arXiv:2309.10855). Flips that cannot be extended are skipped. Private
helper for `neighbor_triangulations(two_neighbors=True)`.

**Arguments:**

- `make_star`: Whether to produce star triangulations. If not specified,
  it is set to whether the current triangulation is star.
- `backend`: The backend used when extending. If not specified, it is
  picked automatically.

**Returns:**
The list of 2-neighbor triangulations. Each differs from the current one
by a single 2-face diagonal flip and is fine and regular (and star if
`make_star`); they are the neighboring Calabi-Yaus.

**Example:**

We construct an FRST and find its 2-neighbors.

```python
p = Polytope([[0,0,1,0],[-2,-2,-1,-2],[0,0,1,2],[-1,0,1,0],
              [1,2,-2,-1],[-1,0,0,-1],[0,1,0,0],[1,0,0,0]])
t = p.triangulate()
neighbors = t.neighbor_triangulations(two_neighbors=True)
len(neighbors) # Print how many 2-neighbors it found
# 2
```

---

---

# ToricVariety Class

Source: https://cy.tools/docs/documentation/toricvariety

## r

## Functions

### `canonical_divisor_is_smooth`

**Description:**
Returns True if the canonical divisor is smooth.

**Arguments:**
None.

**Returns:**
*(bool)* The truth value of the canonical divisor being smooth.

**Example:**

We construct a toric variety and check if its canonical divisor is
smooth.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.canonical_divisor_is_smooth()
# True
```

---

### `clear_cache`

**Description:**
Clears the cached results of any previous computation.

**Arguments:**

- `recursive` *(bool, optional, default=False)*: Whether to also
  clear the cache of the defining triangulation and polytope. This is
  ignored when only\_in\_basis=True.
- `only_in_basis` *(bool, optional, default=False)*: Only clears the
  cache of computations that depend on a choice of basis.

**Returns:**
Nothing.

**Example:**

We construct a toric variety, compute its Mori cone, clear the cache and
then compute it again.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.mori_cone()
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
v.clear_cache() # Clears the cached result
v.mori_cone() # The Mori cone is recomputed
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
```

---

### `curve_basis`

**Description:**
Returns the current basis of curves of the toric variety.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Whether to include
  the origin in the indexing of the vector, or in the basis matrix.
- `as_matrix` *(bool, optional, default=False)*: Indicates whether to
  return the basis as a matrix instead of a list of indices of prime
  toric divisors. Note that if a matrix basis was specified, then it
  will always be returned as a matrix.

**Returns:**
*(numpy.ndarray)* A list of column indices that form a basis. If a more
generic basis has been specified with the
[`set_divisor_basis`](#set_divisor_basis) or
[`set_curve_basis`](#set_curve_basis) functions then it returns a matrix
where the rows are the basis elements specified as a linear combination
of the canonical divisor and the prime toric divisors.

**Example:**

We consider a simple toric variety with two independent curves. If no
basis has been set, then this function finds one. If a basis has been
set, then this function returns it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.curve_basis() # We haven't set any basis
# array([1, 6])
v.set_curve_basis([5,6]) # Here we set a basis
v.curve_basis() # We get the basis we set
# array([5, 6])
v.curve_basis(as_matrix=True) # We get the basis in matrix form
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

---

### `dimension`

**Description:**
Returns the complex dimension of the toric variety.

**Arguments:**
None.

**Returns:**
*(int)* The complex dimension of the toric variety.

**Aliases:**
`dim`.

**Example:**

We construct a toric variety and find its dimension.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
v.dimension()
# 4
```

---

### `divisor_basis`

**Description:**
Returns the current basis of divisors of the toric variety.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Whether to include
  the origin in the indexing of the vector, or in the basis matrix.
- `as_matrix` *(bool, optional, default=False)*: Indicates whether to
  return the basis as a matrix instead of a list of indices of prime
  toric divisors. Note that if a matrix basis was specified, then it
  will always be returned as a matrix.

**Returns:**
*(numpy.ndarray)* A list of column indices that form a basis. If a more
generic basis has been specified with the
[`set_divisor_basis`](#set_divisor_basis) or
[`set_curve_basis`](#set_curve_basis) functions then it returns a
matrix where the rows are the basis elements specified as a linear
combination of the canonical divisor and the prime toric divisors.

**Example:**

We consider a simple toric variety with two independent divisors. If no
basis has been set, then this function finds one. If a basis has been
set, then this function returns it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.divisor_basis() # We haven't set any basis
# array([1, 6])
v.set_divisor_basis([5,6]) # Here we set a basis
v.divisor_basis() # We get the basis we set
# array([5, 6])
v.divisor_basis(as_matrix=True) # We get the basis in matrix form
# array([[0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 1]])
```

---

### `effective_cone`

**Description:**
Returns the cone of effective divisors, aka the effective cone, of the
toric variety.

**Arguments:**
None.

**Returns:**
*(Cone)* The effective cone of the toric variety.

**Example:**

We construct a toric variety and find its effective cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.effective_cone()
# A 2-dimensional rational polyhedral cone in RR^2 generated by 6 rays
```

---

### `fan_cones`

**Description:**
It returns the cones forming a fan defined by a star triangulation of a
reflexive polytope. The dimension of the desired cones can be specified,
and one can also restrict to cones that lie in faces of a particular
dimension.

**Arguments:**

- `d` *(int, optional)*: The dimension of the desired cones. If not
  specified, it returns the full-dimensional cones.
- `face_dim` *(int, optional)*: Restricts to cones that lie on faces of
  the polytope of a particular dimension. If not specified, then no
  restriction is imposed.

**Returns:**
*(tuple)* The tuple of cones with the specified properties defined by
the star triangulation.

**Example:**

We construct a toric variety and find the maximal and 2-dimensional
cones of the defining fan.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
max_cones = v.fan_cones() # By default it returns the maximal cones
cones_2d = v.fan_cones(d=2) # We can select cones of a specific dimension
```

---

### `get_cy`

**Description:**
Returns a CalabiYau object corresponding to the anti-canonical
hypersurface on the toric variety defined by the fine, star, regular
triangulation. If a nef-partition is specified then it returns the
complete intersection Calabi-Yau that it specifies.

**NOTE:**

Only Calabi-Yau 3-fold hypersurfaces are fully supported. Other
dimensions and CICYs require enabling the experimental features of
CYTools. See [experimental features](https://cy.tools/docs/documentation/experimental) for more details.

**Arguments:**

- `nef_partition` *(list, optional)*: A list of tuples of indices
  specifying a nef-partition of the polytope, which correspondingly
  defines a complete intersection Calabi-Yau.

**Returns:**
*(CalabiYau)* The Calabi-Yau arising from the triangulation.

**Example:**

We construct a toric variety and obtain its Calabi-Yau hypersurface.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.get_cy()
# A Calabi-Yau 3-fold hypersurface with h11=2 and h21=272 in a
# 4-dimensional toric variety
```

---

### `glsm_charge_matrix`

**Description:**
Computes the GLSM charge matrix of the theory resulting from this
toric variety.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Indicates whether
  to use the origin in the calculation. This corresponds to the
  inclusion of the canonical divisor.

**Returns:**
*(numpy.ndarray)* The GLSM charge matrix.

**Example:**

We construct a toric variety and find the GLSM charge matrix.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.glsm_charge_matrix()
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

---

### `glsm_linear_relations`

**Description:**
Computes the linear relations of the GLSM charge matrix.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Indicates whether
  to use the origin in the calculation. This corresponds to the
  inclusion of the canonical divisor.

**Returns:**
*(numpy.ndarray)* A matrix of linear relations of the columns of the
GLSM charge matrix.

**Example:**

We construct a toric variety and find its GLSM charge matrix and linear
relations.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.glsm_linear_relations()
# array([[ 1,  1,  1,  1,  1,  1,  1],
#        [ 0,  9, -1,  0,  0,  0,  3],
#        [ 0,  6,  0, -1,  0,  0,  2],
#        [ 0,  1,  0,  0, -1,  0,  0],
#        [ 0,  1,  0,  0,  0, -1,  0]])
v.glsm_linear_relations().dot(p.glsm_charge_matrix().T) # By definition this product must be zero
# array([[0, 0],
#        [0, 0],
#        [0, 0],
#        [0, 0],
#        [0, 0]])
```

---

### `intersection_numbers`

**Description:**
Returns the intersection numbers of the toric variety.

**EXPERIMENTAL FEATURE:**

The intersection numbers are computed as floating-point numbers by
default, but there is the option to turn them into rationals. The
process is fairly quick, but it is unreliable at large \(h^{1,1}\).
Furthermore, verifying that they are correct becomes very slow at large
\(h^{1,1}\).

**Arguments:**

- `in_basis` *(bool, optional, default=False)*: Return the intersection
  numbers in the current basis of divisors.
- `format` *(str, optional, default="dok")*: The output format of the
  intersection numbers. The options are "dok", "coo", and "dense".
  When set to "dok" (Dictionary Of Keys), it returns a dictionary
  where the keys are divisor indices in ascending order and the
  corresponding value is their intersection number. When set to "coo"
  (COOrdinate format), it returns a numpy array in the format
  [[a,b,...,c,K\_ab...c],...], i.e. all but the last entry of each row
  correspond to divisor indices in ascending order, with the last
  entry of the row being their intersection number. Lastly, when set
  to "dense", it returns the full dense array of intersection numbers.
- `zero_as_anticanonical` *(bool, optional, default=False)*: Treat the
  zeroth index as corresponding to the anticanonical divisor instead
  of the canonical divisor.
- `backend` *(str, optional, default="all")*: The sparse linear solver
  to use. Options are "all", "sksparse" and "scipy". When set to "all"
  every solver is tried in order until one succeeds.
- `check` *(bool, optional, default=True)*: Whether to explicitly check
  the solution to the linear system.
- `backend_error_tol` *(float, optional, default=1e-3)*: Error tolerance
  for the solution of the linear system.
- `round_to_zero_threshold` *(float, optional, default=1e-3)*:
  Intersection numbers with magnitude smaller than this threshold are
  rounded to zero.
- `round_to_integer_error_tol` *(float, optional, default=5e-2)*: All
  intersection numbers of the Calabi-Yau hypersurface must be integers
  up to errors less than this value, when the CY is smooth.
- `verbose` *(int, optional, default=0)*: The verbosity level.
  - verbose = 0: Do not print anything.
  - verbose = 1: Print linear backend warnings.
- `exact_arithmetic` *(bool, optional, default=False)*: Converts the
  intersection numbers into exact rational fractions.

**Returns:**
*(dict or numpy.array)* When `format` is set to "dok" (Dictionary Of
Keys), it returns a dictionary where the keys are divisor indices in
ascending order and the corresponding value is their intersection
number. When `format` is set to "coo" (COOrdinate format), it
returns a numpy array in the format [[a,b,...,c,K\_ab...c],...],
i.e. all but the last entry of each row correspond to divisor
indices in ascending order, with the last entry of the row being
their intersection number. Lastly, when set to "dense", it returns
the full dense array of intersection numbers.

**Example:**

We construct a toric variety and compute its intersection numbers We
demonstrate the usage of the `in_basis` flag and the different available
output formats.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
# By default this function computes the intersection numbers of the canonical and prime toric divisors
intnum_nobasis = v.intersection_numbers()
# Let's print the output and see how to interpret it
print(intnum_nobasis)
# {(1, 2, 3, 4): 1.0, (1, 2, 3, 5): 1.0, (1, 2, 4, 6): 0.5, (1, 2, 5, 6): 0.5, [the output is too long so we truncate it]
# The above output means that the intersection number of divisors 1, 2, 3, 4  is 1, and so on
# Let us now compute the intersection numbers in a given basis of divisors
# First, let's check the current basis of divisors
v.divisor_basis()
# array([1, 6])
# Now, setting in_basis=True we only compute the intersection numbers of divisors 1 and 6
intnum_basis = v.intersection_numbers(in_basis=True)
# Let's print the output and see how to interpret it
print(intnum_basis)
# {(0, 0, 1, 1): 0.16666666666667923, (0, 1, 1, 1): -1.0000000000000335, (1, 1, 1, 1): 4.500000000000089}
# Here, the indices correspond to indices of the basis divisors
# So the intersection of 1, 1, 6, 6 is 0.1666, and so on
# Now, let's look at the different output formats. The default one is the "dok" (Dictionary Of Keys) format shown above
# There is also the "coo" (COOrdinate format)
print(v.intersection_numbers(in_basis=True, format="coo"))
# [[ 0.          0.          1.          1.          0.16666667]
#  [ 0.          1.          1.          1.         -1.        ]
#  [ 1.          1.          1.          1.          4.5       ]]
# In this format, all but the last entry of each row are the indices and the last entry of the row is the intersection number
# Lastrly, there is the "dense" format where it outputs the full dense array
print(v.intersection_numbers(in_basis=True, format="dense"))
# [[[[ 0.          0.        ]
#    [ 0.          0.16666667]]
#
#   [[ 0.          0.16666667]
#    [ 0.16666667 -1.        ]]]
#
#
#  [[[ 0.          0.16666667]
#    [ 0.16666667 -1.        ]]
#
#   [[ 0.16666667 -1.        ]
#    [-1.          4.5       ]]]]
```

---

### `is_compact`

**Description:**
Returns True if the variety is compact and False otherwise.

**Arguments:**
None.

**Returns:**
*(bool)* The truth value of the variety being compact.

**Example:**

We construct a toric variety and check if it is compact.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
v.is_compact()
# True
```

---

### `is_smooth`

**Description:**
Returns True if the toric variety is smooth.

**Arguments:**
None.

**Returns:**
*(bool)* The truth value of the toric variety being smooth.

**Example:**

We construct two toric varieties and check if they are smooth.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t1 = p.triangulate()
v1 = t1.get_toric_variety()
v1.is_smooth()
# False
t2 = p.triangulate(include_points_interior_to_facets=True)
v2 = t2.get_toric_variety()
v2.is_smooth()
# True
```

---

### `kahler_cone`

**Description:**
Returns the Kähler cone of the toric variety in the current basis of
divisors.

**Arguments:**
None.

**Returns:**
*(Cone)* The Kähler cone of the toric variety.

**Example:**

We construct a toric variety and find its Kahler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.kahler_cone()
# A rational polyhedral cone in RR^2 defined by 3 hyperplanes normals
```

---

### `mori_cone`

**Description:**
Returns the Mori cone of the toric variety.

**Arguments:**

- `in_basis` *(bool, optional, default=False)*: Use the current basis of
  curves, which is dual to the basis returned by the
  [`divisor_basis`](#divisor_basis) function.
- `include_origin` *(bool, optional, default=True)*: Includes the origin
  of the polytope in the computation, which corresponds to the
  canonical divisor. This parameter is ignored when `in_basis=True`.
- `from_intersection_numbers` *(bool, optional, default=False)*: Compute
  the rays of the Mori cone using the intersection numbers of the
  variety. This can be faster if they are already computed. The set of
  rays may be different, but they define the same cone.

**Returns:**
*(Cone)* The Mori cone of the toric variety.

**Example:**

We construct a toric variety and find its Mori cone in an \(h^{1,1}+d+1\)
dimensional lattice (i.e. without a particular choice of basis) and in
an \(h^{1,1}\) dimensional lattice (i.e. after picking a basis of curves).

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.mori_cone() # By default it does not use a basis of curves.
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
v.mori_cone(in_basis=True) # It uses the dual basis of curves to the current divisor basis
# A 2-dimensional rational polyhedral cone in RR^2 generated by 3 rays
```

---

### `polytope`

**Description:**
Returns the polytope whose triangulation gives rise to the toric
variety.

**Arguments:**
None.

**Returns:**
*(Polytope)* The polytope whose triangulation gives rise to the toric
variety.

**Example:**

We construct a toric variety and check that the polytope that this
function returns is the same as the one we used to construct it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
v.polytope() is p
# True
```

---

### `prime_toric_divisors`

**Description:**
Returns the list of point indices corresponding to prime toric divisors.
This list simply corresponds to the indices of the boundary points that
are used in the triangulation.

**Arguments:**
None

**Returns:**
*(tuple)* The point indices corresponding to prime toric divisors.

**Example:**

We construct a toric variety and find the list of prime toric divisors.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.prime_toric_divisors()
# (1, 2, 3, 4, 5, 6)
```

---

### `set_curve_basis`

**Description:**
Specifies a basis of curves of the toric variety, which in turn induces
a basis of divisors. This can be done with a vector specifying the
indices of the standard basis of the lattice dual to the lattice of
prime toric divisors. Note that this case is equivalent to using the
same vector in the [`set_divisor_basis`](#set_divisor_basis) function.

**NOTE:**

Only integral bases are supported by CYTools, meaning that all toric
curves must be able to be written as an integral linear combination of
the basis curves.

**Arguments:**

- `basis` *(array\_like)*: Vector or matrix specifying a basis. When a
  vector is used, the entries will be taken as indices of the standard
  basis of the dual to the lattice of prime toric divisors. When a
  matrix is used, the rows are taken as linear combinations of the
  aforementioned elements.
- `include_origin` *(bool, optional, default=True)*: Whether to
  interpret the indexing specified by the input vector as including
  the origin.

**Returns:**
Nothing.

**Example:**

We consider a simple toric variety with two independent curves. We first
find the default basis of curves it picks and then set a basis of our
choice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.curve_basis() # We haven't set any basis
# array([1, 6])
v.set_curve_basis([5,6]) # Here we set a basis
v.curve_basis() # We get the basis we set
# array([5, 6])
v.curve_basis(as_matrix=True) # We get the basis in matrix form
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

Note that when setting a curve basis in this way, the function behaves
exactly the same as [`set_divisor_basis`](#set_divisor_basis). For a
more advanced example involving generic bases these two functions
differ. An example can be found in the
[experimental features](https://cy.tools/docs/documentation/experimental) section.

---

### `set_divisor_basis`

**Description:**
Specifies a basis of divisors of the toric variety. This can be done
with a vector specifying the indices of the prime toric divisors.

**NOTE:**

Only integral bases are supported by CYTools, meaning that all prime
toric divisors must be able to be written as an integral linear
combination of the basis divisors.

**Arguments:**

- `basis` *(array\_like)*: Vector or matrix specifying a basis. When a
  vector is used, the entries will be taken as the indices of points
  of the polytope or prime divisors of the toric variety. When a
  matrix is used, the rows are taken as linear combinations of the
  aforementioned divisors.
- `include_origin` *(bool, optional, default=True)*: Whether to
  interpret the indexing specified by the input vector as including
  the origin.

**Returns:**
Nothing.

**Example:**

We consider a simple toric variety with two independent divisors. We
first find the default basis it picks and then we set a basis of our
choice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.divisor_basis() # We haven't set any basis
# array([1, 6])
v.set_divisor_basis([5,6]) # Here we set a basis
v.divisor_basis() # We get the basis we set
# array([5, 6])
v.divisor_basis(as_matrix=True) # We get the basis in matrix form
# array([[0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 1]])
```

An example for more generic basis choices can be found in the
[experimental features](https://cy.tools/docs/documentation/experimental) section.

---

### `sr_ideal`

**Description:**
Returns the Stanley–Reisner ideal of the toric variety.

**Arguments:**
None.

**Returns:**
*(tuple)* The Stanley–Reisner ideal of the toric variety.

**Example:**

We construct a toric variety and find its SR ideal.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.sr_ideal()
# array([[1, 4, 5],
#        [2, 3, 6]])
```

---

### `triangulation`

**Description:**
Returns the triangulation giving rise to the toric variety.

**Arguments:**
None.

**Returns:**
*(Triangulation)* The triangulation giving rise to the toric variety.

**Example:**

We construct a toric variety and check that the triangulation that this
function returns is the same as the one we used to construct it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
v.triangulation() is t
# True
```

---

## Hidden Functions

### `__eq__`

**Description:**
Implements comparison of toric varieties with ==.

**Arguments:**

- `other` *(ToricVariety)*: The other toric variety that is being
  compared.

**Returns:**
*(bool)* The truth value of the toric varieties being equal.

**Example:**

We construct two toric varieties and compare them.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t1 = p.triangulate(backend="qhull")
v1 = t1.get_toric_variety()
t2 = p.triangulate(backend="topcom")
v2 = t2.get_toric_variety()
v1 == v2
# True
```

---

### `__hash__`

**Description:**
Implements the ability to obtain hash values from toric varieties.

**Arguments:**
None.

**Returns:**
*(int)* The hash value of the toric variety.

**Example:**

We compute the hash value of a toric variety. Also, we construct a set
and a dictionary with a toric variety, which make use of the hash
function.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
h = hash(v) # Obtain hash value
d = {v: 1} # Create dictionary with toric variety keys
s = {v} # Create a set of toric varieties
```

---

### `__init__`

## r

### `__ne__`

**Description:**
Implements comparison of toric varieties with !=.

**Arguments:**

- `other` *(ToricVariety)*: The other toric variety that is being
  compared.

**Returns:**
*(bool)* The truth value of the toric varieties being different.

**Example:**

We construct two toric varieties and compare them.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t1 = p.triangulate(backend="qhull")
v1 = t1.get_toric_variety()
t2 = p.triangulate(backend="topcom")
v2 = t2.get_toric_variety()
v1 != v2
# False
```

---

### `__repr__`

**Description:**
Returns a string describing the toric variety.

**Arguments:**
None.

**Returns:**
*(str)* A string describing the toric variety.

**Example:**

This function can be used to convert the toric variety to a string or to
print information about the toric variety.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
var_info = str(v) # Converts to string
print(v) # Prints toric variety info
# A smooth compact 4-dimensional toric variety with 5 affine patches
```

---

### `_compute_mori_rays_from_intersections`

**Description:**
Computes the Mori cone rays of the variety using intersection numbers.

**NOTE:**

This function should generally not be called by the user. Instead, it is
called by the [`mori_cone`](#mori_cone) function when the user wants to
save some time if the intersection numbers were already computed.

**Arguments:**
None.

**Returns:**
*(numpy.ndarray)* The list of generating rays of the Mori cone of the
toric variety.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a toric variety and compute the Mori
cone using its intersection numbers.

```python
p = Polytope([[1,0,0,0,0],[0,1,0,0,0],[0,0,1,0,0],[0,0,0,1,0],[0,0,0,0,1],[-1,-1,-6,-9,-18]])
t = p.triangulate()
v = t.get_toric_variety()
v.mori_cone(from_intersection_numbers=True)
# A 5-dimensional rational polyhedral cone in RR^11 generated by 14 rays
```

---

### `_compute_mori_rays_from_intersections_4d`

**Description:**
Computes the Mori cone rays of the variety using intersection numbers.

**NOTES:**

- This function should generally not be called by the user. Instead,
  this is called by the [`mori_cone`](#mori_cone) function when the
  user wants to save some time if the intersection numbers were
  already computed.
- This function is a more optimized version for 4D toric varieties.

**Arguments:**
None.

**Returns:**
*(numpy.ndarray)* The list of generating rays of the Mori cone of the
toric variety.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a toric variety and compute the Mori
cone using its intersection numbers.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.mori_cone(from_intersection_numbers=True)
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
```

---

### `_construct_intnum_equations`

**Description:**
Auxiliary function used to compute the intersection numbers of the toric
variety.

**Arguments:**
None.

**Returns:**
*(tuple)* A tuple where the first component is a sparse matrix M, the
second is a vector C, which are used to solve the system M\*X=C, the
third is the list of intersection numbers not including
self-intersections, and the fourth is the list of intersection
numbers that are used as variables in the equation.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a toric variety and compute its
intersection numbers.

```python
p = Polytope([[1,0,0,0,0],[0,1,0,0,0],[0,0,1,0,0],[0,0,0,1,0],[0,0,0,0,1],[-1,-1,-6,-9,-18]])
t = p.triangulate()
v = t.get_toric_variety()
intnums = v.intersection_numbers()
```

---

### `_construct_intnum_equations_4d`

**Description:**
Auxiliary function used to compute the intersection numbers of the toric
variety. This function is optimized for 4D varieties.

**Arguments:**
None.

**Returns:**
*(tuple)* A tuple where the first component is a sparse matrix M, the
second is a vector C, which are used to solve the system M\*X=C, the
third is the list of intersection numbers not including
self-intersections, and the fourth is the list of intersection
numbers that are used as variables in the equation.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a toric variety and compute its
intersection numbers.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
intnums = v.intersection_numbers()
```

---

---

# CalabiYau Class

Source: https://cy.tools/docs/documentation/calabiyau

## r

## Functions

### `ambient_dimension`

**Description:**
Returns the complex dimension of the ambient toric variety.

**Arguments:**
None.

**Returns:**
*(int)* The complex dimension of the ambient toric variety.

**Aliases:**
`ambient_dim`.

**Example:**

We construct a Calabi-Yau and find the dimension of its ambient variety.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
cy = t.get_cy()
cy.ambient_dimension()
# 4
```

---

### `ambient_variety`

**Description:**
Returns the ambient toric variety.

**Arguments:**
None.

**Returns:**
*(ToricVariety)* The ambient toric variety.

**Example:**

We construct a Calabi-Yau hypersurface in a toric variety and check
that this function returns the ambient variety.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
cy = v.get_cy()
cy.ambient_variety() is v
# True
```

---

### `chi`

**Description:**
Computes the Euler characteristic of the Calabi-Yau.

**NOTE:**

Only Calabi-Yau hypersurfaces of dimension 2-4 are currently supported.
Hodge numbers of CICYs are computed with PALP.

**Arguments:**
None.

**Returns:**
*(int)* The Euler characteristic of the Calabi-Yau manifold.

**Example:**

We construct a Calabi-Yau hypersurface and compute its Euler
characteristic.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.chi()
# -540
```

---

### `clear_cache`

**Description:**
Clears the cached results of any previous computation.

**Arguments:**

- `recursive` *(bool, optional, default=False)*: Whether to also clear
  the cache of the ambient toric variety, defining triangulation, and
  polytope. This is ignored when only\_in\_basis=True.
- `only_in_basis` *(bool, optional, default=False)*: Only clears the
  cache of computations that depend on a choice of basis.

**Returns:**
Nothing.

**Example:**

We construct a CY hypersurface, compute its toric Mori cone, clear the
cache and then compute it again.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.toric_mori_cone()
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
cy.clear_cache() # Clears the cached result
cy.toric_mori_cone() # The Mori cone is recomputed
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
```

---

### `compute_curve_volumes`

**Description:**
Computes the volume of the curves corresponding to (not necessarily
minimal) generators of the Mori cone inferred from toric geometry (i.e.
the cone obtained with the [`toric_mori_cone`](#toric_mori_cone)
function).

**Arguments:**

- `tloc` *(array\_like)*: A vector specifying a location in the Kähler
  cone.
- `only_extremal` *(bool, optional, default=False)*: Use only the
  extremal rays of the Mori cone.

**Returns:**
*(numpy.ndarray)* The list of volumes of the curves.

**Example:**

We construct a Calabi-Yau hypersurface and find the volumes of the
generators of the Mori cone at the tip of the stretched Kähler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
tip = cy.toric_kahler_cone().tip_of_stretched_cone(1)
cy.compute_curve_volumes(tip)
# array([0.99997511, 3.99992091, 0.99998193])
```

As expected, all generators of the Mori cone have volumes greater than
or equal to 1 (up to rounding errors) at the tip of the stretched
Kähler cone.

---

### `compute_cy_volume`

**Description:**
Computes the volume of the Calabi-Yau at a location in the Kähler cone.

**Arguments:**

- `tloc` *(array\_like)*: A vector specifying a location in the Kähler
  cone.

**Returns:**
*(float)* The volume of the Calabi-Yau at the specified location.

**Example:**

We construct a Calabi-Yau hypersurface and find its volume at the tip
of the stretched Kähler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
tip = cy.toric_kahler_cone().tip_of_stretched_cone(1)
cy.compute_cy_volume(tip)
# 3.4999999988856496
```

---

### `compute_divisor_volumes`

**Description:**
Computes the volume of the basis divisors at a location in the Kähler
cone.

The volume of the ith divisor is 0.5\*kappa\_{ijk} t^j t^k.

**Arguments:**

- `tloc` *(array\_like)*: A vector specifying a location in the Kähler
  cone.
- `in_basis` *(bool, optional, default=False)*: When set to True, the
  volumes of the current basis of divisors are computed. Otherwise,
  the volumes of all prime toric divisors are computed.

**Returns:**
*(numpy.ndarray)* The list of volumes of the prime toric divisors or of
the basis divisors at the specified location.

**Example:**

We construct a Calabi-Yau hypersurface and find the volumes of the
prime toric divisors at the tip of the stretched Kähler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
tip = cy.toric_kahler_cone().tip_of_stretched_cone(1)
cy.compute_divisor_volumes(tip)
# array([ 2.5       , 23.99999999, 16.        ,  2.5       ,  2.5       ,
#         0.5       ])
```

---

### `compute_gvs`

**Description:**
Wrapper for cygv GV computations. A method of `cytools.CalabiYau`. If
both `max_deg` and `min_points` are left unspecified, only the points in
`mcap_generators` are used.

**Arguments:**

- `mcap_generators`: Generators for the Mori cone cap. If provided,
  these are used as the set of charges to compute invariants for.
- `grading_vec`: The grading vector to use in the computations. A default
  is chosen if none is provided.
- `max_deg`: The maximum degree to compute GVs to.
- `min_points`: The minimum number of GVs to compute.
- `target_points`: A list of target points to compute GVs for.
- 'basis': An array specifying a new basis to represent the charges in.
- 'format': A string to request 'dok' or 'coo' formats.

**Returns:**
The GV invariants.

---

### `compute_gws`

**Description:**
Wrapper for cygv GW computations. A method of `cytools.CalabiYau`. If
both `max_deg` and `min_points` are left unspecified, only the points in
`mcap_generators` are used.

**Arguments:**

- `mcap_generators`: Generators for the Mori cone cap. If provided,
  these are used as the set of charges to compute invariants for.
- `grading_vec`: The grading vector to use in the computations. A default
  is chosen if none is provided.
- `max_deg`: The maximum degree to compute GWs to.
- `min_points`: The minimum number of GWs to compute.
- `target_points`: A list of target points to compute GWs for.
- 'basis': An array specifying a new basis to represent the charges in.
- 'format': A string to request 'dok' or 'coo' formats.

**Returns:**
The GW invariants.

---

### `compute_inverse_kahler_metric`

**Description:**
Computes the inverse Kähler metric at a location in the Kähler cone.

**NOTE:**

This function only supports Calabi-Yau 3-folds.

**Arguments:**

- `tloc` *(array\_like)*: A vector specifying a location in the Kähler
  cone.

**Returns:**
*(numpy.ndarray)* The inverse Kähler metric at the specified location.

**Example:**

We construct a Calabi-Yau hypersurface and compute the inverse Kähler
metric at the tip of the stretched Kähler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
tip = cy.toric_kahler_cone().tip_of_stretched_cone(1)
cy.compute_inverse_kahler_metric(tip)
# array([[11., -9.],
#        [-9., 43.]])
```

---

### `compute_kahler_metric`

**Description:**
Computes the Kähler metric at a location in the Kähler cone.

**NOTE:**

This function only supports Calabi-Yau 3-folds.

**Arguments:**

- `tloc` *(array\_like)*: A vector specifying a location in the Kähler
  cone.

**Returns:**
*(numpy.ndarray)* The Kähler metric at the specified location.

**Example:**

We construct a Calabi-Yau hypersurface and compute the Kähler metric at
the tip of the stretched Kähler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
tip = cy.toric_kahler_cone().tip_of_stretched_cone(1)
cy.compute_kahler_metric(tip)
# array([[0.10969388, 0.02295918],
#        [0.02295918, 0.02806122]])
```

---

### `compute_kappa_matrix`

## r

### `compute_kappa_vector`

## r

### `curve_basis`

**Description:**
Returns the current basis of curves of the Calabi-Yau.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Whether to include
  the origin in the indexing of the vector, or in the basis matrix.
- `as_matrix` *(bool, optional, default=False)*: Indicates whether to
  return the basis as a matrix instead of a list of indices of prime
  toric divisors. Note that if a matrix basis was specified, then it
  will always be returned as a matrix.

**Returns:**
*(numpy.ndarray)* A list of column indices that form a basis. If a more
generic basis has been specified with the
[`set_divisor_basis`](#set_divisor_basis) or
[`set_curve_basis`](#set_curve_basis) functions then it returns a
matrix where the rows are the basis elements specified as a linear
combination of the canonical divisor and the prime toric divisors.

**Example:**

We consider a simple Calabi-Yau with two independent curves. If no
basis has been set, then this function finds one. If a basis has been
set, then this function returns it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.curve_basis() # We haven't set any basis
# array([1, 6])
cy.set_curve_basis([5,6]) # Here we set a basis
cy.curve_basis() # We get the basis we set
# array([5, 6])
cy.curve_basis(as_matrix=True) # We get the basis in matrix form
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

---

### `dimension`

**Description:**
Returns the complex dimension of the Calabi-Yau hypersurface.

**Arguments:**
None.

**Returns:**
*(int)* The complex dimension of the Calabi-Yau hypersurface.

**Aliases:**
`dim`.

**Example:**

We construct a Calabi-Yau and find its dimension.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
cy = t.get_cy()
cy.dimension()
# 3
```

---

### `divisor_basis`

**Description:**
Returns the current basis of divisors of the Calabi-Yau.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Whether to include
  the origin in the indexing of the vector, or in the basis matrix.
- `as_matrix` *(bool, optional, default=False)*: Indicates whether to
  return the basis as a matrix instead of a list of indices of prime
  toric divisors. Note that if a matrix basis was specified, then it
  will always be returned as a matrix.

**Returns:**
*(numpy.ndarray)* A list of column indices that form a basis. If a more
generic basis has been specified with the
[`set_divisor_basis`](#set_divisor_basis) or
[`set_curve_basis`](#set_curve_basis) functions then it returns a
matrix where the rows are the basis elements specified as a linear
combination of the canonical divisor and the prime toric divisors.

**Example:**

We consider a simple Calabi-Yau with two independent divisors. If no
basis has been set, then this function finds one. If a basis has been
set, then this function returns it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.divisor_basis() # We haven't set any basis
# array([1, 6])
cy.set_divisor_basis([5,6]) # Here we set a basis
cy.divisor_basis() # We get the basis we set
# array([5, 6])
cy.divisor_basis(as_matrix=True) # We get the basis in matrix form
# array([[0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 1]])
```

---

### `glsm_charge_matrix`

**Description:**
Computes the GLSM charge matrix of the theory.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Indicates whether
  to use the origin in the calculation. This corresponds to the
  inclusion of the canonical divisor.

**Returns:**
*(numpy.ndarray)* The GLSM charge matrix.

**Example:**

We construct a Calabi-Yau hypersurface and compute its GLSM charge
matrix.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.glsm_charge_matrix()
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

---

### `glsm_linear_relations`

**Description:**
Computes the linear relations of the GLSM charge matrix.

**Arguments:**

- `include_origin` *(bool, optional, default=True)*: Indicates whether
  to use the origin in the calculation. This corresponds to the
  inclusion of the canonical divisor.

**Returns:**
*(numpy.ndarray)* A matrix of linear relations of the columns of the
GLSM charge matrix.

**Example:**

We construct a Calabi-Yau hypersurface and compute the GLSM linear
relations.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.glsm_linear_relations()
# array([[ 1,  1,  1,  1,  1,  1,  1],
#        [ 0,  9, -1,  0,  0,  0,  3],
#        [ 0,  6,  0, -1,  0,  0,  2],
#        [ 0,  1,  0,  0, -1,  0,  0],
#        [ 0,  1,  0,  0,  0, -1,  0]])
```

---

### `h11`

**Description:**
Returns the Hodge number \(h^{1,1}\) of the Calabi-Yau.

**NOTE:**

Only Calabi-Yau hypersurfaces of dimension 2-4 are currently supported.
Hodge numbers of CICYs are computed with PALP.

**Arguments:**
None.

**Returns:**
*(int)* The Hodge number \(h^{1,1}\) of Calabi-Yau manifold.

**Example:**

We construct a Calabi-Yau hypersurface and compute its \(h^{1,1}\).

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.h11()
# 2
```

---

### `h12`

**Description:**
Returns the Hodge number \(h^{1,2}\) of the Calabi-Yau.

**NOTE:**

Only Calabi-Yau hypersurfaces of dimension 2-4 are currently supported.
Hodge numbers of CICYs are computed with PALP.

**Arguments:**
None.

**Returns:**
*(int)* The Hodge number \(h^{1,2}\) of Calabi-Yau manifold.

**Aliases:**
`h21`.

**Example:**

We construct a Calabi-Yau hypersurface and compute its \(h^{1,2}\).

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.h12()
# 272
```

---

### `h13`

**Description:**
Returns the Hodge number \(h^{1,3}\) of the Calabi-Yau.

**NOTE:**

Only Calabi-Yau hypersurfaces of dimension 2-4 are currently supported.
Hodge numbers of CICYs are computed with PALP.

**Arguments:**
None.

**Returns:**
*(int)* The Hodge number \(h^{1,3}\) of Calabi-Yau manifold.

**Aliases:**
`h31`.

**Example:**

We construct a Calabi-Yau hypersurface and compute its \(h^{1,3}\).

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.h13()
# 0
```

---

### `h22`

**Description:**
Returns the Hodge number \(h^{2,2}\) of the Calabi-Yau.

**NOTE:**

Only Calabi-Yau hypersurfaces of dimension 2-4 are currently supported.
Hodge numbers of CICYs are computed with PALP.

**Arguments:**
None.

**Returns:**
*(int)* The Hodge number \(h^{2,2}\) of Calabi-Yau manifold.

**Example:**

We construct a Calabi-Yau hypersurface and compute its \(h^{2,2}\).

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.h22()
# 0
```

---

### `hpq`

**Description:**
Returns the Hodge number \(h^{p,q}\) of the Calabi-Yau.

**NOTES:**

- Only Calabi-Yau hypersurfaces of dimension 2-4 are currently
  supported. Hodge numbers of CICYs are computed with PALP.
- This function always computes Hodge numbers from scratch, unless
  they were computed with PALP. The functions [`h11`](#h11),
  [`h21`](#h21), [`h12`](#h12), [`h13`](#h13), and [`h22`](#h22)
  delegate to `Polytope`, which caches the results.

**Arguments:**

- `p` *(int)*: The holomorphic index of the Dolbeault cohomology of
  interest.
- `q` *(int)*: The anti-holomorphic index of the Dolbeault cohomology
  of interest.

**Returns:**
*(int)* The Hodge number \(h^{p,q}\) of the arising Calabi-Yau manifold.

**Example:**

We construct a Calabi-Yau and check some of its Hodge numbers.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.hpq(0,0)
# 1
cy.hpq(0,1)
# 0
cy.hpq(1,1)
# 2
cy.hpq(1,2)
# 272
```

---

### `intersection_numbers`

**Description:**
Returns the intersection numbers of the Calabi-Yau manifold.

**EXPERIMENTAL FEATURE:**

The intersection numbers are computed as integers when the Calabi-Yau
is smooth, and a subset of the prime toric divisors is used as the
basis. Otherwise, they are computed as floating-point numbers. There is
the option to turn them into rationals. The process is fairly quick,
but it is unreliable at large \(h^{1,1}\). Furthermore, verifying that
they are correct becomes very slow at large \(h^{1,1}\).

**Arguments:**

- `in_basis` *(bool, optional, default=False)*: Return the intersection
  numbers in the current basis of divisors.
- `format` *(str, optional, default="dok")*: The output format of the
  intersection numbers. The options are "dok", "coo", and "dense".
  When set to "dok" (Dictionary Of Keys), it returns a dictionary
  where the keys are divisor indices in ascending order and the
  corresponding value is their intersection number. When set to "coo"
  (COOrdinate format), it returns a numpy array in the format
  [[a,b,...,c,K\_ab...c],...], i.e. all but the last entry of each row
  correspond to divisor indices in ascending order, with the last
  entry of the row being their intersection number. Lastly, when set
  to "dense", it returns the full dense array of intersection numbers.
- `zero_as_anticanonical` *(bool, optional, default=False)*: Treat the
  zeroth index as corresponding to the anticanonical divisor instead
  of the canonical divisor.
- `backend` *(str, optional, default="all")*: The sparse linear solver
  to use. Options are "all", "sksparse" and "scipy". When set to
  "all" every solver is tried in order until one succeeds.
- `check` *(bool, optional, default=True)*: Whether to explicitly check
  the solution to the linear system.
- `backend_error_tol` *(float, optional, default=1e-3)*: Error
  tolerance for the solution of the linear system.
- `round_to_zero_threshold` *(float, optional, default=1e-3)*:
  Intersection numbers with magnitude smaller than this threshold are
  rounded to zero.
- `round_to_integer_error_tol` *(float, optional, default=5e-2)*: All
  intersection numbers of the Calabi-Yau hypersurface must be
  integers up to errors less than this value, when the CY is smooth.
- `verbose` *(int, optional, default=0)*: The verbosity level.
  - verbose = 0: Do not print anything.
  - verbose = 1: Print linear backend warnings.
- `exact_arithmetic` *(bool, optional, default=False)*: Converts the
  intersection numbers into exact rational fractions.

**Returns:**
*(dict or numpy.array)* When `format` is set to "dok" (Dictionary Of
Keys), it returns a dictionary where the keys are divisor indices in
ascending order and the corresponding value is their intersection
number. When `format` is set to "coo" (COOrdinate format), it returns a
numpy array in the format [[a,b,...,c,K\_ab...c],...], i.e. all but the
last entry of each row correspond to divisor indices in ascending
order, with the last entry of the row being their intersection number.
Lastly, when set to "dense", it returns the full dense array of
intersection numbers.

**Example:**

We construct a toric variety and compute its intersection numbers We
demonstrate the usage of the `in_basis` flag and the different
available output formats.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
# By default this function computes the intersection numbers of the
# canonical and prime toric divisors
intnum_nobasis = cy.intersection_numbers()
# Let's print the output and see how to interpret it
print(intnum_nobasis)
# {(1, 2, 3): 18, (2, 3, 4): 18, (1, 3, 4): 2, (1, 2, 4): 3, (1, 2, 5):
# 3, (2, 3, 5): 18, [the output is too long so we truncate it]
# The above output means that the intersection number of divisors 1, 2,
# 3  is 18, and so on
# Let us now compute the intersection numbers in a given basis of
# divisors
# First, let's check the current basis of divisors
cy.divisor_basis()
# array([1, 6])
# Now, setting in_basis=True we only compute the intersection numbers
# of divisors 1 and 6
intnum_basis = cy.intersection_numbers(in_basis=True)
# Let's print the output and see how to interpret it
print(intnum_basis)
# {(0, 0, 1): 1, (0, 1, 1): -3, (1, 1, 1): 9}
# Here, the indices correspond to indices of the basis divisors
# So the intersection of 1, 1, 6 is 1, and so on
# Now, let's look at the different output formats. The default one is
# the "dok" (Dictionary Of Keys) format shown above
# There is also the "coo" (COOrdinate format)
print(cy.intersection_numbers(in_basis=True, format="coo"))
# [[ 0  0  1  1]
#  [ 0  1  1 -3]
#  [ 1  1  1  9]]
# In this format, all but the last entry of each row are the indices
# and the last entry of the row is the intersection number
# Lastrly, there is the "dense" format where it outputs the full dense
# array
print(cy.intersection_numbers(in_basis=True, format="dense"))
# [[[ 0  1]
#   [ 1 -3]]
#
#  [[ 1 -3]
#   [-3  9]]]
```

---

### `is_smooth`

**Description:**
Returns True if the Calabi-Yau is smooth.

**Arguments:**
None.

**Returns:**
*(bool)* The truth value of the CY being smooth.

**Example:**

We construct a Calabi-Yau hypersurface and check if it is smooth.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.is_smooth()
# True
```

---

### `is_trivially_equivalent`

**Description:**
Checks if the Calabi-Yaus are trivially equivalent by checking if the
restrictions of the triangulations to codimension-2 faces are the same.
Polytope automorphisms are also taken into account. This function is
only implemented for CY hypersurfaces.

**INFO:**

This function only provides a fairly trivial equivalence check. When
this function returns False, there is still the possibility of the
Calabi-Yaus being equivalent, but is only made evident with a change of
basis. The full equivalence check is generically very difficult, so it
is not implemented.

**Arguments:**

- `other` (CalabiYau): The other CY that is being compared.

**Returns:**
(boolean) The truth value of the CYs being trivially equivalent.

**Example:**

We construct two Calabi-Yaus and compare them. We also show how to get
the set of Calabi-Yaus that are not trivially equivalent. As previously
mentioned, if two CYs are not trivially equivalent it does not mean
that they are actually inequivalent as there might exist some more
complicated basis transformation that relates them.

```python
p = Polytope([[-1,0,0,0],[-1,1,0,0],[-1,0,1,0],[2,-1,0,-1],[2,0,-1,-1],[2,-1,-1,-1],[-1,0,0,1],[-1,1,0,1],[-1,0,1,1]])
triangs = p.all_triangulations(as_list=True)
cy0 = triangs[0].get_cy()
cy1 = triangs[1].get_cy()
print(cy0.is_trivially_equivalent(cy1))
# False
cys_not_triv_eq = {t.get_cy() for t in triangs} # Not trivially equivalent, but not necessarily inequivalent
print(len(triangs),len(cys_not_triv_eq))        # We see that many CYs from these triangulations can be trivially equated
# 102 5
```

---

### `polytope`

**Description:**
Returns the polytope whose triangulation gives rise to the ambient
toric variety.

**Arguments:**
None.

**Returns:**
*(Polytope)* The polytope whose triangulation gives rise to the ambient
toric variety.

**Example:**

We construct a Calabi-Yau and check that the polytope that this
function returns is the same as the one we used to construct it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
cy = t.get_cy()
cy.polytope() is p
# True
```

---

### `prime_toric_divisors`

**Description:**
Returns the list of inherited prime toric divisors. Due to the sorting
of points in the polytope class, this list is trivial for
hypersurfaces, but may be non-trivial for CICYs. The indices in the
returned tuple correspond to indices of the corresponding points of the
polytope (i.e. if \(n\) is in the tuple, then the \(n\)th point in
`p.points()` is a prime toric divisor that intersects the CY).

**Arguments:**
None

**Returns:**
*(tuple)* A list of indices indicating the points in the polytope whose
corresponding prime toric divisor intersects the CY.

**Example:**

We construct a Calabi-Yau hypersurface and find the list of prime toric
divisors.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.prime_toric_divisors()
# (1, 2, 3, 4, 5, 6)
```

---

### `second_chern_class`

**Description:**
Computes the second Chern class of the CY hypersurface. Returns the
integral of the second Chern class over the prime effective divisors.

**NOTE:**

This function currently only supports CY 3-folds.

**Arguments:**

- `in_basis` *(bool, optional, default=False)*: Only return the
  integrals over a basis of divisors.
- `include_origin` *(bool, optional, default=True)*: Include the origin
  in the vector, which corresponds to the canonical divisor.

**Returns:**
*(numpy.ndarray)* A vector containing the integrals.

**Example:**

We construct a Calabi-Yau hypersurface and compute its second Chern
class.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.second_chern_class()
# array([-612,   36,  306,  204,   36,   36,   -6])
```

---

### `set_curve_basis`

**Description:**
Specifies a basis of curves of the Calabi-Yau, which in turn induces a
basis of divisors. This can be done with a vector specifying the
indices of the standard basis of the lattice dual to the lattice of
prime toric divisors. Note that this case is equivalent to using the
same vector in the [`set_divisor_basis`](#set_divisor_basis) function.

**NOTE:**

Only integral bases are supported by CYTools, meaning that all toric
curves must be able to be written as an integral linear combination of
the basis curves.

**Arguments:**

- `basis` *(array\_like)*: Vector or matrix specifying a basis. When a
  vector is used, the entries will be taken as indices of the
  standard basis of the dual to the lattice of prime toric divisors.
  When a matrix is used, the rows are taken as linear combinations of
  the aforementioned elements.
- `include_origin` *(bool, optional, default=True)*: Whether to
  interpret the indexing specified by the input vector as including
  the origin.

**Returns:**
Nothing.

**Example:**

We consider a simple Calabi-Yau with two independent curves. We first
find the default basis of curves it picks and then set a basis of our
choice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.curve_basis() # We haven't set any basis
# array([1, 6])
cy.set_curve_basis([5,6]) # Here we set a basis
cy.curve_basis() # We get the basis we set
# array([5, 6])
cy.curve_basis(as_matrix=True) # We get the basis in matrix form
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

Note that when setting a curve basis in this way, the function behaves
exactly the same as [`set_divisor_basis`](#set_divisor_basis). For a
more advanced example involving generic bases these two functions
differ. An example can be found in the
[experimental features](https://cy.tools/docs/documentation/experimental) section.

---

### `set_divisor_basis`

**Description:**
Specifies a basis of divisors of the Calabi-Yau. This can be done with
a vector specifying the indices of the prime toric divisors.

**NOTE:**

Only integral bases are supported by CYTools, meaning that all prime
toric divisors must be able to be written as an integral linear
combination of the basis divisors.

**Arguments:**

- `basis` *(array\_like)*: Vector or matrix specifying a basis. When a
  vector is used, the entries will be taken as the indices of points
  of the polytope or prime divisors of the toric variety. When a
  matrix is used, the rows are taken as linear combinations of the
  aforementioned divisors.
- `include_origin` *(bool, optional, default=True)*: Whether to
  interpret the indexing specified by the input vector as including
  the origin.

**Returns:**
Nothing.

**Example:**

We consider a simple Calabi-Yau with two independent divisors. We first
find the default basis it picks and then we set a basis of our choice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.divisor_basis() # We haven't set any basis
# array([1, 6])
cy.set_divisor_basis([5,6]) # Here we set a basis
cy.divisor_basis() # We get the basis we set
# array([5, 6])
cy.divisor_basis(as_matrix=True) # We get the basis in matrix form
# array([[0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 1]])
```

An example for more generic basis choices can be found in the
[experimental features](https://cy.tools/docs/documentation/experimental) section.

---

### `toric_effective_cone`

**Description:**
Returns the cone of effective divisors, aka the effective cone,
inferred from toric geometry.

**Arguments:**
None.

**Returns:**
*(Cone)* The toric effective cone.

**Example:**

We construct a Calabi-Yau hypersurface and find its toric effective
cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.toric_effective_cone()
# A 2-dimensional rational polyhedral cone in RR^2 generated by 6 rays
```

---

### `toric_kahler_cone`

**Description:**
Returns the Kähler cone inferred from toric geometry in the current
basis of divisors.

**Arguments:**
None.

**Returns:**
*(Cone)* The Kähler cone inferred from toric geometry.

**Example:**

We construct a Calabi-Yau hypersurface and find its Kähler cone.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.toric_kahler_cone()
# A rational polyhedral cone in RR^2 defined by 3 hyperplanes normals
```

---

### `toric_mori_cone`

**Description:**
Returns the Mori cone inferred from toric geometry.

**Arguments:**

- `in_basis` *(bool, optional, default=False)*: Use the current basis
  of curves, which is dual to what the basis returned by the
  [`divisor_basis`](#divisor_basis) function.
- `include_origin` *(bool, optional, default=True)*: Includes the
  origin of the polytope in the computation, which corresponds to the
  canonical divisor.

**Returns:**
*(Cone)* The Mori cone inferred from toric geometry.

**Example:**

We construct a Calabi-Yau hypersurface and find its Mori cone in an
\(h^{1,1}+d+1\) dimensional lattice (i.e. without a particular choice of
basis) and in an \(h^{1,1}\) dimensional lattice (i.e. after picking a
basis of curves).

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
cy = t.get_cy()
cy.toric_mori_cone() # By default it does not use a basis of curves.
# A 2-dimensional rational polyhedral cone in RR^7 generated by 3 rays
cy.toric_mori_cone(in_basis=True) # It uses the dual basis of curves to the current divisor basis
# A 2-dimensional rational polyhedral cone in RR^2 generated by 3 rays
```

---

### `triangulation`

**Description:**
Returns the triangulation giving rise to the ambient toric variety.

**Arguments:**
None.

**Returns:**
*(Triangulation)* The triangulation giving rise to the ambient toric
variety.

**Example:**

We construct a Calabi-Yau and check that the triangulation that this
function returns is the same as the one we used to construct it.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
cy = t.get_cy()
cy.triangulation() is t
# True
```

---

## Hidden Functions

### `__eq__`

**Description:**
Implements comparison of Calabi-Yaus with ==.

**INFO:**

This function provides only a fairly trivial comparison using the
[`is_trivially_equivalent`](#is_trivially_equivalent) function. It is
not recommended to compare CYs with ==, and a warning will be printed
every time it evaluates to False. This is only implemented so that sets
and dictionaries of CYs can be created. The
[`is_trivially_equivalent`](#is_trivially_equivalent) function should
be used to avoid confusion.

**Arguments:**

- `other` *(CalabiYau)*: The other CY that is being compared.

**Returns:**
*(bool)* The truth value of the CYs being equal.

**Example:**

We construct two Calabi-Yaus and compare them. We use the
[`is_trivially_equivalent`](#is_trivially_equivalent) instead of this
function, since it is recommended to avoid confusion.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t1 = p.triangulate(backend="qhull")
cy1 = t1.get_cy()
t2 = p.triangulate(backend="topcom")
cy2 = t2.get_cy()
cy1.is_trivially_equivalent(cy2)
# True
```

---

### `__hash__`

**Description:**
Implements the ability to obtain hash values from Calabi-Yaus.

**Arguments:**
None.

**Returns:**
*(int)* The hash value of the CY.

**Example:**

We compute the hash value of a Calabi-Yau. Also, we construct a set and
a dictionary with a Calabi-Yau, which make use of the hash function.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
cy = t.get_cy()
h = hash(cy) # Obtain hash value
d = {cy: 1} # Create dictionary with Calabi-Yau keys
s = {cy} # Create a set of Calabi-Yaus
```

---

### `__init__`

## r

### `__ne__`

**Description:**
Implements comparison of Calabi-Yaus with !=.

**INFO:**

This function provides only a fairly trivial comparison using the
[`is_trivially_equivalent`](#is_trivially_equivalent) function. It is
not recommended to compare CYs with !=, and a warning will be printed
every time it evaluates to False. This is only implemented so that sets
and dictionaries of CYs can be created. The
[`is_trivially_equivalent`](#is_trivially_equivalent) function should
be used to avoid confusion.

**Arguments:**

- `other` *(CalabiYau)*: The other CY that is being compared.

**Returns:**
*(bool)* The truth value of the CYs being different.

**Example:**

We construct two Calabi-Yaus and compare them. We use the
[`is_trivially_equivalent`](#is_trivially_equivalent) instead of
this function, since it is recommended to avoid confusion.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t1 = p.triangulate(backend="qhull")
cy1 = t1.get_cy()
t2 = p.triangulate(backend="topcom")
cy2 = t2.get_cy()
cy1.is_trivially_equivalent(cy2)
# True
```

---

### `__repr__`

**Description:**
Returns a string describing the Calabi-Yau manifold.

**Arguments:**
None.

**Returns:**
*(str)* A string describing the Calabi-Yau manifold.

**Example:**

This function can be used to convert the Calabi-Yau to a string or to
print information about the Calabi-Yau.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
cy = t.get_cy()
cy_info = str(cy) # Converts to string
print(cy) # Prints Calabi-Yau info
# A Calabi-Yau 3-fold hypersurface with h11=1 and h21=101 in a
# 4-dimensional toric variety
```

---

### `_compute_cicy_hodge_numbers`

**Description:**
Computes the Hodge numbers of a CICY using PALP. The results are stored
in a hidden dictionary.

**NOTE:**

This function should generally not be called by the user. Instead, it
is called by [`hpq`](#hpq) and other Hodge number functions when
necessary.

**Arguments:**

- `only_from_cache` *(bool, optional, default=False)*: Check if the
  Hodge numbers of the CICY were previously computed and are stored in
  the cache of the polytope object. Only if this flag is false and the
  Hodge numbers are not cached, then PALP is used to compute them.

**Returns:**
Nothing.

**Example:**

This function is not intended to be directly used, but it is used in
the following example. We construct a CICY and compute some of its
Hodge numbers.

```python
p = Polytope([[1,0,0,0,0],[0,1,0,0,0],[0,0,1,0,0],[0,0,0,1,0],[-1,-1,-6,-9,0],[0,0,0,0,1],[0,0,0,0,-1]])
nef_part = p.nef_partitions(compute_hodge_numbers=False)
t = p.triangulate(include_points_interior_to_facets=True)
cy = t.get_cy(nef_part[0])
cy.h11() # The function is called here since the Hodge numbers have not been computed
# 4
cy.h21() # It is not called here because the Hodge numbers are already cached
# 544
```

---

### `_compute_gvs_gws`

**Description:**
Wrapper for cygv GV and GW computations. A method of `cytools.CalabiYau`. If
both `max_deg` and `min_points` are left unspecified, only the points in
`basis` are used.

NOT INTENDED TO BE CALLED DIRECTLY!

**Arguments:**

- `gv_or_gw`: String specifying whether 'gv' or 'gw' computations are
  performed.
- `mcap_generators`: Generators for the Mori cone cap. If provided,
  these are used as the set of charges to compute invariants for.
- `grading_vec`: The grading vector to use in the computations. A default
  is chosen if none is provided.
- `max_deg`: The maximum degree to compute GVs/GWs to.
- `min_points`: The minimum number of GVs/GWs to compute.
- `target_points`: A list of target points to compute GVs/GWs for.
- 'basis': An array specifying a new basis to represent the charges in.
- 'format': A string to request 'dok' or 'coo' formats.

**Returns:**
The GV/GW invariants.

---

---

# Cone Class

Source: https://cy.tools/docs/documentation/cone

This class handles all computations relating to rational polyhedral cones,
such cone duality and extremal ray computations. It is mainly used for the
study of Kähler and Mori cones.

**WARNING:**

This class is primarily tailored to pointed (i.e. strongly convex) cones.
There are a few computations, such as finding extremal rays, that may
produce some unexpected results when working with non-pointed cones.

## Constructor

### `cytools.cone.Cone`

**Description:**
Constructs a `Cone` object. This is handled by the hidden
[`__init__`](#__init__) function.

**Arguments:**

- `rays`: A list of rays that generates the cone. If it is not specified then the hyperplane normals must be specified.
- `hyperplanes` *(array\_like, optional)*: A list of inward-pointing
  hyperplane normals that define the cone. If it is not specified then the
  generating rays must be specified.
- `check` *(bool, optional, default=True)*: Whether to check the input.
  Recommended if constructing a cone directly.

**NOTE:**

Exactly one of `rays` or `hyperplanes` must be specified. Otherwise an
exception is raised.

**Example:**

We construct a cone in two different ways. First from a list of rays then
from a list of hyperplane normals. We verify that the two inputs result in
the same cone.

```python
from cytools import Cone
c1 = Cone([[0,1],[1,1]]) # Create a cone using rays. It can also be done with Cone(rays=[[0,1],[1,1]])
c2 = Cone(hyperplanes=[[1,0],[-1,1]]) # Create a cone using hyperplane normals.
c1 == c2 # We verify that the two cones are the same.
# True
```

---

## Functions

### `ambient_dimension`

**Description:**
Returns the dimension of the ambient lattice.

**Arguments:**
None.

**Returns:**
*(int)* The dimension of the ambient lattice.

**Aliases:**
`ambient_dim`.

**Example:**

We construct a cone and find the dimension of the ambient lattice.

```python
c = Cone([[0,1,0],[1,1,0]])
c.ambient_dimension()
# 3
```

---

### `clear_cache`

**Description:**
Clears the cached results of any previous computation.

**Arguments:**
None.

**Returns:**
Nothing.

**Example:**

We construct a cone, compute its extremal rays, clear the cache and
then compute them again.

```python
c = Cone([[1,0],[1,1],[0,1]])
c.extremal_rays()
# array([[0, 1],
#        [1, 0]])
c.clear_cache() # Clears the cached result
c.extremal_rays() # The extremal rays recomputed
# array([[0, 1],
#        [1, 0]])
```

---

### `contains`

**Description:**
Checks if a point is in the (strict) interior.

**Arguments:**

- `other`: The object to check containment of. Can be a 1D array, which
  is treated as a point. Can be a 2D array, which is treated as a
  list of points. Can be a Cone.
- `eps`: Check H@pt >= eps.

**Returns:**
Whether pt is in the (strict) interior.

---

### `dimension`

**Description:**
Returns the dimension of the cone.

**Arguments:**
None.

**Returns:**
*(int)* The dimension of the cone.

**Aliases:**
`dim`.

**Example:**

We construct a cone and find its dimension.

```python
c = Cone([[0,1,0],[1,1,0]])
c.dimension()
# 2
```

---

### `dual_cone`

**Description:**
Returns the dual cone.

**Arguments:**
None.

**Returns:**
*(Cone)* The dual cone.

**Aliases:**
`dual`.

**Example:**

We construct a cone and find its dual cone.

```python
c = Cone([[0,1],[1,1]])
c.dual_cone()
# A rational polyhedral cone in RR^2 defined by 2 hyperplanes normals
c.dual_cone().rays()
# array([[ 1,  0],
#        [-1,  1]])
```

---

### `extremal_hyperplanes`

**Description:**
Returns the extremal hyperplanes of the cone.

**Arguments:**

- `tol`: Specifies the tolerance for deciding whether a hyperplane is
  extremal or not. Only used if method=="nnls".
- `minimal`: Whether to return a minimal generating set of hyperplane.
  For duals of pointed cones, there is a unique minimal generating
  set -- the extremal hyperplanes. For non-pointed cones, one can
  have a collection of extremal hyperplanes defining the cone that is
  not minimal with respect to hyperplane count.
- `method`: If calling `is_extremal`, this sets the method used for
  extremality checking. Can be "lp" or "nnls". Recommendation is "lp".
- verbose: When set to True it show the progress while finding the
  extremal hyperplanes.

**Returns:**
The list of extremal hyperplanes of the cone.

---

### `extremal_rays`

**Description:**
Returns the extremal rays of the cone.

**NOTE:**

By default, this function will use as many CPU threads as there are
available. To fix the number of threads, you can set the `n_threads`
variable in the `config` submodule.

**Arguments:**

- `tol`: Specifies the tolerance for deciding whether a ray is extremal
  or not. Only used if method=="nnls".
- `minimal`: Whether to return a minimal generating set of rays. For
  pointed cones, there is a unique minimal generating set -- the
  extremal rays. For non-pointed cones, one can have a collection of
  extremal rays generating the cone that is not minimal with respect
  to ray count.
- `method`: If calling `is_extremal`, this sets the method used for
  extremality checking. Can be "lp" or "nnls". Recommendation is "lp".
- verbose: When set to True it show the progress while finding the
  extremal rays.

**Returns:**
The list of extremal rays of the cone.

**Example:**

We construct a cone and find its extremal\_rays.

```python
c = Cone([[0,1],[1,1],[1,0]])
c.extremal_rays()
# array([[0, 1],
#        [1, 0]])
```

---

### `face_lattice`

**Description:**
Computes the positive-dimensional face lattice of a pointed cone.

The faces are organized in a tuple of increasing codim. This method is
distinct from `facets` since this will be a lot slower for high-dim
H-cones.

**Arguments:**

- `codim`: Optional codim of the desired faces. When set to `0`, returns
  the cone itself.
- `include_self`: Whether to include the codim-0 face when returning all
  faces.
- `verbosity`: The verbosity level.

**Returns:**
A tuple of `Cone` objects of codimension `codim`, if specified.
Otherwise, a tuple of tuples of cone faces.

---

### `facets`

**Description:**
Get the facets of the cone.

This is easy if:
-) the cone is simplicial OR
-) the cone is solid and the extremal hyperplanes can be computed.
Otherwise, the computation uses both rays and hyperplanes... this is
semi-expensive to compute...

**Arguments:**

- `verbosity`: The verbosity level.

**Returns:**
The facets of the cone.

---

### `find_grading_vector`

## r

### `find_interior_point`

## r

### `find_lattice_points`

**Description:**
Finds lattice points in the cone. The points are found in the region
bounded by the cone, and by a cutoff surface given by the grading
vector. Note that this requires the cone to be pointed. The minimum
number of points to find can be specified, or if working with a
preferred grading vector it is possible to specify the maximum degree.

**Arguments:**

- `min_points` *(int, optional)*: Specifies the minimum number of points
  to find. The degree will be increased until this minimum number is
  achieved.
- `max_deg` *(int, optional)*: The maximum degree of the points to
  find. This is useful when working with a preferred grading.
- `grading_vector` *(array\_like, optional)*: The grading vector that
  will be used. If it is not specified then it is computed.
- `c` *(numeric or array\_like, optional)*: The minimum allowed
  stretching. Can be a single number or a stretching per each
  hyperplane (applied in the order of self.hyperplanes()).
- `max_coord` *(int, optional, default=1000)*: The maximum magnitude of
  the coordinates of the points.
- `deg_window` *(int, optional)*: If using min\_points, search for
  lattice points with degrees in range [n*(deg\_window+1),
  n*(deg\_window+1)+deg\_window] for 0<=n
- `filter_function` *(function, optional)*: A function to use as a
  filter of the points that will be kept. It should return a boolean
  indicating whether to keep the point. Note that `min_points` does
  not take the filtering into account.
- `process_function` *(function, optional)*: A function to process the
  points as they are found. This is useful to avoid first constructing
  a large list of points and then processing it.
- `fast_mode` *(bool, optional)*: Allow quicker lattice point
  computations for small cones. Doesn't use degree-based methods.
  Instead uses Linf norm.
- `max_B`: *(int, optional)*: Max Linf norm allowed in fast\_mode.
- `verbose` *(boolean, optional)*: Whether to print extra diagnostic
  information (True) or not (False).

**Returns:**
*(numpy.ndarray)* The list of points.

**Example:**

We construct a cone and find at least 20 lattice points in it.

```python
c = Cone([[3,2],[5,3]])
pts = c.find_lattice_points(min_points=20)
print(len(pts)) # We see that it found 21 points
# 21
```

Let's also give an example where we use a function to apply some
filtering. This can be something very complicated, but here we just
pick the points where all coordinates are odd.

```python
def filter_function(pt):
    return all(c%2 for c in pt)

c = Cone([[3,2],[5,3]])
pts = c.find_lattice_points(min_points=20, filter_function=filter_function)
print(len(pts)) # Now we get only 6 points instead of 21
# 6
```

Finally, let's give an example where we process the data as it comes
instead of first constructing a list. In this simple example we just
print each point with odd coordinates, but in general it can be a
complex algorithm.

```python
def process_function(pt):
    if all(c%2 for c in pt):
        print(f"Processing point {pt}")

c = Cone([[3,2],[5,3]])
c.find_lattice_points(min_points=20, process_function=process_function)
# Processing point (5, 3)
# Processing point (11, 7)
# Processing point (15, 9)
# Processing point (17, 11)
# Processing point (21, 13)
# Processing point (25, 15)
```

---

### `hilbert_basis`

**Description:**
Returns the Hilbert basis of the cone. Normaliz is used for the
computation.

**Arguments:**
None.

**Returns:**
*(numpy.ndarray)* The list of vectors forming the Hilbert basis.

**Example:**

We compute the Hilbert basis of a two-dimensional cone.

```python
c = Cone([[1,3],[2,1]])
c.hilbert_basis()
# array([[1, 1],
#        [1, 2],
#        [1, 3],
#        [2, 1]])
```

---

### `hyperplanes`

**Description:**
Returns the inward-pointing normals to the hyperplanes that define the
cone.

**Arguments:**

- `use_extremal_rays` :Whether to use extremal rays in this
  computation, or just any rays.
- `verbosity`: The verbosity level.

**Returns:**
*(numpy.ndarray)* The list of inward-pointing normals to the
hyperplanes that define the cone.

**Example:**

We construct two cones and find their hyperplane normals.

```python
c1 = Cone([[0,1],[1,1]])
c2 = Cone(hyperplanes=[[0,1],[1,1]])
c1.hyperplanes()
# array([[ 1,  0],
#        [-1,  1]])
c2.hyperplanes()
# array([[0, 1],
#        [1, 1]])
```

---

### `intersection`

**Description:**
Computes the intersection with another cone, or with a list of cones.

**Arguments:**

- `other` *(Cone or array\_like)*: The other cone that is being
  intersected, or a list of cones to intersect with.

**Returns:**
*(Cone)* The cone that results from the intersection.

**Example:**

We construct two cones and find their intersection.

```python
c1 = Cone([[1,0],[1,2]])
c2 = Cone([[0,1],[2,1]])
c3 = c1.intersection(c2)
c3.rays()
# array([[2, 1],
#        [1, 2]])
```

---

### `is_degenerate`

**Description:**
Checks if a cone {x : H@x>=0} is degenerate. I.e., does any x in this
cone saturate >=d+1 hyperplanes simultaneously, for d the ambient dim?
If so, the cone is degenerate.

This is representation-sensitive. Just because the cone is degenerate
for a certain representation matrix, H, doesn't mean that it's
degenerate for all representation matrices. Probably best to use H as
the *extremal hyperplanes*.

Application: It is more difficult to compute the (extremal or not) rays
of a degenerate cone.

**Arguments:**

- `use_extremal_hyperplanes`: Whether the check the extremal hyperplanes
  for degeneracy. If False, the naive self.hyperplanes() will be used.
- `M`: The (absolute value of the) bounds on variables considered.
- `certificate`: Whether to return a certificate x as well as the
  hyperplanes the solver claims it saturates
- `verbosity`: The verbosity level.

**Returns:**
The maximum number of hyperplanes that a single x can saturate
simultaneously.

If certificate==True, also return (x,z)

---

### `is_pointed`

**Description:**
Returns True if the cone is pointed (i.e. strongly convex). A cone is
pointed if no x exists such that both x and -x are in the cone.

If one has hyperplanes, this check is as simple as `not full_rank(H)`
since, if H is not full rank, then some x has H@x==0. I.e., H@(+x)>=0
and H@(-x)>=0.

If one has rays, this check can be done either via
1) finding some psi such that psi.r > 0 for all rays r
2) checking if some lmbda!=0 exist such that R.T@lmbda = 0

The backends are, in order of preference,
1) (backend='dual') check if dual is solid
2) (backend='null') hyperplane rank
3) (backend='lp') rays@lmbda=0 via LP
4) (backend='nnls') rays@lmbda=0 via nnls

**Arguments:**

- `backend`: Specifies which backend to use. Available options are
  "dual", "null", "lp", and "nnls".
- `tol`: The tolerance for determining when a linear subspace is found.
  This is only used for the NNLS backend.

**Returns:**
The truth value of the cone being pointed.

**Aliases:**
`is_strongly_convex`.

**Example:**

We construct two cones and check if they are pointed.

```python
c1 = Cone([[1,0],[0,1]])
c2 = Cone([[1,0],[0,1],[-1,0]])
c1.is_pointed()
# True
c2.is_pointed()
# False
```

---

### `is_simplicial`

**Description:**
Returns True if the cone is simplicial.

N.B.: if c is solid, then c is simplicial <=> c.dual() is simplicial.

A sometimes-simpler check if c is solid, then, is to check if
#(extremal hyperplanes) = dim.

**Arguments:**
None.

**Returns:**
*(bool)* The truth value of the cone being simplicial.

**Example:**

We construct two cones and check if they are simplicial.

```python
c1 = Cone([[1,0,0],[0,1,0],[0,0,1]])
c2 = Cone([[1,0,0],[0,1,0],[0,0,1],[1,1,-1]])
c1.is_simplicial()
# True
c2.is_simplicial()
# False
```

---

### `is_smooth`

**Description:**
Returns True if the cone is smooth, i.e. its extremal rays either form a
basis of the ambient lattice, or they can be extended into one.

**Arguments:**
None.

**Returns:**
*(bool)* The truth value of the cone being smooth.

**Example:**

We construct two cones and check if they are smooth.

```python
c1 = Cone([[1,0,0],[0,1,0],[0,0,1]])
c2 = Cone([[2,0,1],[0,1,0],[1,0,2]])
c1.is_smooth()
# True
c2.is_smooth()
# False
```

---

### `is_solid`

**Description:**
Returns True if the cone is solid, i.e. if it is full-dimensional.

**NOTE:**

If the generating rays are known then this can simply be checked by
computing the dimension of the linear space that they span. However,
when only the hyperplane inequalities are known this can be a difficult
problem. When using PPL as the backend, the convex hull is explicitly
constructed and checked. The other backends try to find a point in the
strict interior of the cone, which fails if the cone is not solid. The
latter approach is much faster, but there could be extremely narrow
cones where the optimization fails and this function returns a false
negative.

**Arguments:**

- `backend` *(str, optional)*: Specifies which backend to use. Available
  options are "ppl", and any backends available for the
  [`find_interior_point`](#find_interior_point) function. If not
  specified, it uses the default backend of the
  [`find_interior_point`](#find_interior_point) function.

**Returns:**
*(bool)* The truth value of the cone being solid.

**Aliases:**
`is_full_dimensional`.

**Example:**

We construct two cones and check if they are solid.

```python
c1 = Cone([[1,0],[0,1]])
c2 = Cone([[1,0,0],[0,1,0]])
c1.is_solid()
# True
c2.is_solid()
# False
```

---

### `lineality_space`

**Description:**
Returns the lineality space as a formal cone object.

This Cone object a bit odd since, by definition, the lineality space is
the largest *linear subspace* in the cone, so it allows coefficients of
any sign. Regardless, it's convenient to package this as a Cone

**Arguments:**
None.

**Returns:**
*(Cone)* A cone defining the lineality space.

---

### `pointed_space`

**Description:**
A cone can be decomposed into its lineality space and its pointed
component.

The pointed component is obtained by intersection of the cone with the
orthogonal complement of the lineality space. I.e., want to impose
H@x=0 for any x in the lineality space.

**Arguments:**
None.

**Returns:**
*(Cone)* The pointed part of the cone.

---

### `rays`

**Description:**
Returns the (not necessarily extremal) rays that generate the cone.

**Arguments:**

- `use_extremal_hyperplanes`: Whether to use extremal hyperplanes in
  this computation, or just any hyperplanes.
- `verbosity`: The verbosity level.

**Returns:**
*(numpy.ndarray)* The list of rays that generate the cone.

**Example:**

We construct two cones and find their generating rays.

```python
c1 = Cone([[0,1],[1,1]])
c2 = Cone(hyperplanes=[[0,1],[1,1]])
c1.rays()
# array([[0, 1],
#        [1, 1]])
c2.rays()
# array([[ 1,  0],
#        [-1,  1]])
```

---

### `tip_of_stretched_cone`

## r

## Hidden Functions

### `__eq__`

**Description:**
Implements comparison of cones with ==.

**NOTE:**

The comparison of cones that are not pointed, and whose duals are also
not pointed, is not supported.

**Arguments:**

- `other` *(Cone)*: The other cone that is being compared.

**Returns:**
*(bool)* The truth value of the cones being equal.

**Example:**

We construct two cones and compare them.

```python
c1 = Cone([[0,1],[1,1]])
c2 = Cone(hyperplanes=[[1,0],[-1,1]])
c1 == c2
# True
```

---

### `__hash__`

**Description:**
Implements the ability to obtain hash values from cones.

**NOTE:**

Cones that are not pointed, and whose duals are also not pointed, are
not supported.

**Arguments:**
None.

**Returns:**
*(int)* The hash value of the cone.

**Example:**

We compute the hash value of a cone. Also, we construct a set and a
dictionary with a cone, which make use of the hash function.

```python
c = Cone([[0,1],[1,1]])
h = hash(c) # Obtain hash value
d = {c: 1} # Create dictionary with cone keys
s = {c} # Create a set of cones
```

---

### `__init__`

**Description:**
Initializes a `Cone` object.

**Arguments:**

- `rays`: A list of rays that generates the cone. If it is not
  specified then the hyperplane normals must be specified.
- `hyperplanes`: A list of inward-pointing hyperplane normals that
  define the cone. If it is not specified then the generating rays
  must be specified.
- `check`: Whether to check the input. Recommended if constructing a
  cone directly.
- `copy`: Whether to ensure we copy the input rays/hyperplanes.
  Recommended.
- `ambient_dim`: The ambient dimension of the cone, if not inferrable.

**NOTE:**

Exactly one of `rays` or `hyperplanes` must be specified. Otherwise, an
exception is raised.

**Returns:**
Nothing.

**Example:**

This is the function that is called when creating a new `Cone` object.
We construct a cone in two different ways. First from a list of rays
then from a list of hyperplane normals. We verify that the two inputs
result in the same cone.

```python
from cytools import Cone
c1 = Cone([[0,1],[1,1]]) # Create a cone using rays. It can also be done with Cone(rays=[[0,1],[1,1]])
c2 = Cone(hyperplanes=[[1,0],[-1,1]]) # Create a cone using hyperplane normals.
c1 == c2 # We verify that the two cones are the same.
# True
```

---

### `__ne__`

**Description:**
Implements comparison of cones with !=.

**NOTE:**

The comparison of cones that are not pointed, and whose duals are also
not pointed, is not supported.

**Arguments:**

- `other` *(Cone)*: The other cone that is being compared.

**Returns:**
*(bool)* The truth value of the cones being different.

**Example:**

We construct two cones and compare them.

```python
c1 = Cone([[0,1],[1,1]])
c2 = Cone(hyperplanes=[[1,0],[-1,1]])
c1 != c2
# False
```

---

### `__repr__`

**Description:**
Returns a string describing the cone.

**Arguments:**
None.

**Returns:**
*(str)* A string describing the cone.

**Example:**

This function can be used to convert the Cone to a string or to print
information about the cone.

```python
c = Cone([[1,0],[1,1],[0,1]])
cone_info = str(c) # Converts to string
print(c) # Prints cone info
# A 2-dimensional rational polyhedral cone in RR^2 generated by 3 rays
```

---

---

# Misc Functions

Source: https://cy.tools/docs/documentation/other

There are various other functions in CYTools that don't belong to any particular class. They are defined in different places according to where they most closely belong. Here we list the location of the definitions of these functions as well as their documentation.

## Functions in `cytools.polytope`

### `is_reflexive_barebones`

**Description:**
Minimal code to check if conv(points) is reflexive.

**Arguments:**

- `points`: The points defining the hull.
- `backend`: The backend to use. See poly\_v\_to\_h.

**Returns:**
Whether conv(points) is reflexive

---

### `poly_v_to_h`

**Description:**
Generate the H-representation of a polytope, given the V-representation.
I.e., map points/vertices to hyperplanes inequalities.

The inequalities are in the form
c*0 \* x\_0 + ... + c*{d-1} \* x\_{d-1} + c\_d >= 0

**Arguments:**

- `pts`: The input points. Each row is a point.
- `backend`: The backend to use. Currently, support "ppl", "qhull", and
  "palp".

**Returns:**
The hyperplane inequalities in the form
c*0 \* x\_0 + ... + c*{d-1} \* x\_{d-1} + c\_d >= 0
and, depending on backend/dimension, the formal convex hull of the points.

---

### `saturating_lattice_pts`

**Description:**
Computes the lattice points contained in conv(pts), along with the indices
of the hyperplane inequalities that they saturate.

**Arguments:**

- `pts`: A list of points spanning the hull.
- `ineqs`: Hyperplane inqualities defining the hull. Same format as
  output by poly\_v\_to\_h
- `dim`: The dimension of the hull.
- `backend`: The backend to use. Either "palp" or defaults to native.

**Returns:**
An array of all lattice points (the rows).
A list of sets of all inequalities each lattice point saturates.

---

## Functions in `cytools.triangulation`

### `_cgal_triangulate`

**Description:**
Computes a regular triangulation using CGAL.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the [`Triangulation`](https://cy.tools/docs/documentation/triangulation) class when using CGAL as the
backend.

**Arguments:**

- `points`: A list of points.
- `heights`: A list of heights defining the regular triangulation.

**Returns:**
A list of simplices defining a regular triangulation.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a triangulation using CGAL.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.triangulate(backend="cgal")
# A fine, star triangulation of a 4-dimensional point configuration with 7
# points in ZZ^4
```

---

### `_qhull_triangulate`

**Description:**
Computes a regular triangulation using QHull.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the [`Triangulation`](https://cy.tools/docs/documentation/triangulation) class when using QHull as
the backend.

**Arguments:**

- `points`: A list of points.
- `heights`: A list of heights defining the regular triangulation.

**Returns:**
A list of simplices defining a regular triangulation.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a triangulation using QHull.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.triangulate(backend="qhull")
# A fine, star triangulation of a 4-dimensional point configuration with 7
# points in ZZ^4
```

---

### `_to_star`

**Description:**
Turns a triangulation into a star triangulation by deleting internal lines
and connecting all points to the origin.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the [`Triangulation`](https://cy.tools/docs/documentation/triangulation) class when needed.

**INFO:**

This function is only reliable for triangulations of reflexive polytopes
and may produce invalid triangulations for other polytopes.

**Arguments:**

- `triang`: The triangulation to convert to star.

**Returns:**
Nothing.

---

### `_topcom_triangulate`

**Description:**
Computes the placing/pushing triangulation using TOPCOM.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the [`Triangulation`](https://cy.tools/docs/documentation/triangulation) class when using TOPCOM as
the backend.

**Arguments:**

- `points`: A list of points.

**Returns:**
A list of simplices defining a triangulation.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a triangulation using TOPCOM.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
p.triangulate(backend="topcom")
# A fine, star triangulation of a 4-dimensional point configuration with 7
# points in ZZ^4
```

---

### `all_triangulations`

**Description:**
Computes all triangulations of the input point configuration using TOPCOM.
There is the option to only compute fine, regular or fine triangulations.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the [`all_triangulations`](https://cy.tools/docs/documentation/polytope#all_triangulations) function
of the [`Polytope`](https://cy.tools/docs/documentation/polytope) class.

**Arguments:**

- `poly`: The ambient polytope.
- `pts`: The list of points to be triangulated. Specified by labels.
- `only_fine`: Restricts to only fine triangulations.
- `only_regular`: Restricts to only regular triangulations.
- `only_star`: Restricts to only star triangulations.
- `star_origin`: The index of the point that will be used as the star
  origin. If the polytope is reflexive this is set to 0, but otherwise it
  must be specified.
- `backend`: The optimizer used to check regularity computation. The
  available options are "topcom" and the backends of the
  [`is_solid`](https://cy.tools/docs/documentation/cone#is_solid) function of the [`Cone`](https://cy.tools/docs/documentation/cone) class.
  If not specified, it will be picked automatically. Note that using
  TOPCOM to check regularity is slower.
- `raw_output`: Return the triangulations as lists of simplices instead of
  as Triangulation objects.

**Returns:**
A generator of [`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects with the
specified properties. If `raw_output` is set to True then numpy arrays are
used instead.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a polytope and find all of its
triangulations. We try picking different restrictions and see how the number
of triangulations changes.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-2,-1,-1],[-2,-1,-1,-1]])
g = p.all_triangulations()
next(g) # Takes some time while TOPCOM finds all the triangulations
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
next(g) # Produces the next triangulation immediately
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 7 points in ZZ^4
len(p.all_triangulations(as_list=True)) # Number of fine, regular, star triangulations
# 2
len(p.all_triangulations(only_regular=False, only_star=False, only_fine=False, as_list=True) )# Number of triangularions, no matter if fine, regular, or star
# 6
```

---

### `random_triangulations_fair_generator`

## r

### `random_triangulations_fast_generator`

Constructs pseudorandom regular (optionally fine and star) triangulations
of a given point set. This is done by picking random heights around the
Delaunay heights from a Gaussian distribution.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the
[`random_triangulations_fast`](https://cy.tools/docs/documentation/polytope#random_triangulations_fast)
function of the [`Polytope`](https://cy.tools/docs/documentation/polytope) class.

**IMPORTANT:**

This function produces random triangulations very quickly, but it does not
produce a fair sample. When a fair sampling is required the
[`random_triangulations_fair`](https://cy.tools/docs/documentation/polytope#random_triangulations_fair)
function should be used.

**Arguments:**

- `poly`: The ambient polytope.
- `pts`: The list of points to be triangulated. Specified by labels.
- `N`: Number of desired unique triangulations. If not specified, it will
  generate as many triangulations as it can find until it has to retry
  more than max\_retries times to obtain a new triangulation.
- `c`: A constant used as the standard deviation of the Gaussian
  distribution used to pick the heights. A larger c results in a wider
  range of possible triangulations, but with a larger fraction of them
  being non-fine, which slows down the process when using only\_fine=True.
- `max_retries`: Maximum number of attempts to obtain a new triangulation
  before the process is terminated.
- `make_star`: Converts the obtained triangulations into star
  triangulations.
- `only_fine`: Restricts to fine triangulations.
- `backend`: Specifies the backend used to compute the triangulation. The
  available options are "cgal" and "qhull".
- `seed`: A seed for the random number generator. This can be used to
  obtain reproducible results.
- `verbosity`: The verbosity level.

**Returns:**
A generator of [`Triangulation`](https://cy.tools/docs/documentation/triangulation) objects with the
specified properties.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We construct a polytope and find some random
triangulations. The triangulations are obtained very quickly, but they are
not a fair sample of the space of triangulations. For a fair sample, the
[`random_triangulations_fair`](https://cy.tools/docs/documentation/polytope#random_triangulations_fair)
function should be used.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]]).dual()
g = p.random_triangulations_fast()
next(g) # Runs very quickly
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 106 points in ZZ^4
next(g) # Keeps producing triangulations until it has trouble finding more
# A fine, regular, star triangulation of a 4-dimensional point
# configuration with 106 points in ZZ^4
rand_triangs = p.random_triangulations_fast(N=10, as_list=True) # Produces the list of 10 triangulations very quickly
```

---

## Functions in `cytools.calabiyau`

### `_group_by_deg`

**Description:**
Organize the charges by their degrees.

**Arguments:**

- `charges`: The charges.
- `grading_vec`: The grading vector.
- `as_np_arr`: Whether to map charges to np.array (True) or leave as set (False).

**Returns:**
*(dictionary)* Dictionary mapping degree to charges.

---

### `def __init__`

---

### `def charges`

---

### `def cone`

---

### `def cutoff`

---

### `def grading_vec`

---

### `def gvs`

---

### `def gws`

---

### `def invariant`

---

### `def size`

---

## Functions in `cytools.cone`

### `_is_degenerate`

**Description:**
Checks if a cone {x : H@x>=0} is degenerate. I.e., does any x in this cone
saturate >=d+1 hyperplanes simultaneously, for d the ambient dim? If so, the
cone is degenerate.

This is representation-sensitive. Just because the cone is degenerate for a
certain representation matrix, H, doesn't mean that it's degenerate for all
representation matrices. Probably best to use H as the *extremal
hyperplanes*.

Uses CP-SAT from OR-Tools.

Application: It is more difficult to compute the (extremal or not) rays of
a degenerate cone.

**Arguments:**

- `H`: The inwards-facing hyperplanes defining the cone.
- `M`: The (absolute value of the) bounds on variables considered.
- `certificate`: Whether to return a certificate x as well as the
  hyperplanes the solver claims it saturates
- `verbosity`: The verbosity level.

**Returns:**
Whether the cone {x : H@x>=0} is degenerate.

If certificate==True, also return (x,z)

---

### `dualize`

**Description:**
Converts between hyperplanes and rays of a cone. Output isn't guaranteed to
be extremal.

Internal to this function, we treat M as the hyperplanes since that seems
to be faster.

**Arguments:**

- `M`: The matrix defining the cone.
  Can be thought of as the hyperplanes cone = {x: M@x>=0} in which case we
  return the rays cone = {dualize(M).T@lmbda: lmbda>=0}.
  Can also be thought of as the rays cone = {M.T@lmbda: lmbda>=0} in
  which case we return the hypeplanes cone = {x: dualize(M)@x>=0}.
- `verbosity`: The verbosity level.

**Returns:**
The dual description

---

### `feasibility`

**Description:**
Solve a feasibility problem Ax>=c.

**Arguments:**

- `hyperplanes`: The constraining hyperplanes, A.
- `c`: The 'stretching'.
- `ambient_dim`: The ambient dimension... A.shape[1].
- `backend`: The backend to use. Options are "highs" (LP, on HiGHS),
  "glop" (LP, on ORTools), "scip", or "cpsat".
- `verbose`: Whether to print extra diagnostic info.

**Returns:**
A feasible point, if it exists. Else, None.

---

### `is_extremal`

**Description:**
Auxiliary function that is used to find the extremal rays of cones. Returns
True if the ray is extremal and False otherwise. It has additional
parameters that are used when parallelizing.

**Arguments:**

- `R`: A matrix whose rows are the rays of the cone.
- `i`: The index of the ray to check for extremality.
- `extFlags`: A list of flags indicating if the rays r in R are possibly
  extremal. If a ray is known non-extremal, delete it.
- `method`: The method to check extremality. Can be "lp" or "nnls".
  Reccomendation is "lp".
- `tol`: The tolerance for determining whether a ray is extremal.

**Returns:**
*(bool or None)* The truth value of the ray being extremal.

**Example:**

This function is not meant to be directly used by the end user. Instead it
is used by the [`extremal_rays`](#extremal_rays) function. We construct a
cone and find its extremal\_rays.

```python
c = Cone([[0,1],[1,1],[1,0]])
c.extremal_rays()
# array([[0, 1],
#        [1, 0]])
```

---

## Functions in `cytools.utils`

### `array_from_flint`

**Description:**
Converts a numpy array with fmpz/fmpq (Flint's integer/float number class)
entries to 64-bit integer/float entries.

**Arguments:**

- `arr`: A numpy array with fmpz/fmpq entries.

**Returns:**
A numpy array with 64-bit integer/float entries.

---

### `array_to_flint`

**Description:**
Converts a numpy array with either:
1) 64-bit integer entries or
2) float entries
to Flint type (fmpz or fmpq for integer or rational numbers, respectively).

See <https://flintlib.org/doc/fmpz.html> and
<https://flintlib.org/doc/fmpq.html>

**Arguments:**

- `arr`: A numpy array with either 64-bit integer or float entries.

**Returns:**
A numpy array with either fmpz or fmpq entries.

**Example:**

We convert an integer array to an fmpz array.

```python
from cytools.utils import array_int_to_fmpz
arr = [[1,0,0],[0,2,0],[0,0,3]]
array_int_to_fmpz(arr)
# array([[1, 0, 0],
#        [0, 2, 0],
#        [0, 0, 3]], dtype=object)
```

---

### `fetch_polytopes`

**Description:**
Fetches reflexive polytopes from the Kreuzer-Skarke database or from the
Schöller-Skarke database. The data is fetched from the websites
<http://hep.itp.tuwien.ac.at/~kreuzer/CY/> and
<http://rgc.itp.tuwien.ac.at/fourfolds/> respectively.

**NOTE:**

The Kreuzer-Skarke database does not store favorability data. Thus, when
setting favorable to True or False it fetches additional polytopes so that
after filtering by favorability it can saturate the requested limit.
However, it may happen that fewer polytopes than requested are returned
even though more exist. To verify that no more polytopes with the requested
conditions exist one can increase the limit significantly and check if more
polytopes are returned.

**Arguments:**

- `h11`: The Hodge number \(h^{1,1}\) of the Calabi-Yau hypersurface.
- `h12`: The Hodge number \(h^{1,2}\) of the Calabi-Yau hypersurface.
- `h13`: The Hodge number \(h^{1,3}\) of the Calabi-Yau hypersurface.
- `h21`: The Hodge number \(h^{2,1}\) of the Calabi-Yau hypersurface. This is
  equivalent to the h12 parameter.
- `h22`: The Hodge number \(h^{2,2}\) of the Calabi-Yau hypersurface.
- `h31`: The Hodge number \(h^{3,1}\) of the Calabi-Yau hypersurface. This is
  equivalent to the h13 parameter.
- `chi`: The Euler characteristic of the Calabi-Yau hypersurface.
- `lattice`: The lattice on which the polytope is defined. Options are "N"
  and "M". Has to be specified if the Hodge numbers or the Euler
  characteristic is specified.
- `dim`: The dimension of the polytope. Only available options are 4 and 5.
- `n_points`: The number of lattice points of the desired polytopes.
- `n_vertices`: The number of vertices of the desired polytopes.
- `n_dual_points`: The number of points of the dual polytopes of the
  desired polytopes.
- `n_facets`: The number of facets of the desired polytopes.
- `limit`: The maximum number of fetched polytopes.
- `samples`: Allow sampling of polytopes. Requires as\_list=True and
  samples<limit.
- `sample_seed`: A random number seed for sampling polytopes.
- `timeout`: The maximum number of seconds to wait for the server to return
  the data.
- `as_list`: Return the list of polytopes instead of a generator.
- `backend`: A string that specifies the backend used for the
  [`Polytope`](https://cy.tools/docs/documentation/polytope) class.
- `deterministic_glsm_basis`: Whether to fix the GLSM basis in a
  deterministic manner. By setting this True, the GLSM/divisor bases of
  the associated Polytope/CYs should be consistent across different
  machines. If this is left as False, then bases will be computed
  identically to how they were before this flag was added.
  N.B.: the basis chosen under `deterministic_glsm_basis=True` may
  differ from the basis chosen under `deterministic_glsm_basis=False`!
- `dualize`: Flag that indicates whether to dualize all the polytopes
  before yielding them.
- `favorable`: Yield or return only polytopes that are favorable when set
  to True, or non-favorable when set to False. If not specified then it
  yields both favorable and non-favorable polytopes.
- `verbostiy`: The verbosity level.

**Returns:**
A generator of [`Polytope`](https://cy.tools/docs/documentation/polytope) objects, or the full list when
`as_list` is set to True.

**Example:**

We fetch polytopes from the Kreuzer-Skarke and Schöller-Skarke databases
with a few different parameters.

```python
from cytools import fetch_polytopes # Note that it can directly be imported from the root
g = fetch_polytopes(h11=27, as_list=False) # Constructs a generator of polytopes
next(g)
# A 4-dimensional reflexive lattice polytope in ZZ^4
l = fetch_polytopes(h11=27, limit=100) # Constructs a list of polytopes
print(f"Fetched {len(l)} polytopes")
# Fetched 100 polytopes
g_5d = fetch_polytopes(h11=1000, as_list=False, dim=5, limit=100) # Generator of 5D polytopes
next(g_5d)
# A 5-dimensional reflexive lattice polytope in ZZ^5
```

---

### `filter_tensor_indices`

**Description:**
Selects a specific subset of indices from a tensor.

The tensor is reindexed so that indices are in the range 0..len(indices)
with the ordering specified by the input indices. This function can be used
to convert the tensor of intersection numbers to a given basis.

**Arguments:**

- `tensor`: The input symmetric sparse tensor of the form of a dictionary
  {(a,b,...,c):M\_ab...c, ...}.
- `indices`: The list of indices that will be preserved.

**Returns:**
A dictionary describing a tensor in the same format as the input, but only with the desired indices.

**Example:**

We construct a simple tensor and then filter some of the indices. We also
give a concrete example of when this is used for intersection numbers.

```python
from cytools.utils import filter_tensor_indices
tensor = {(0,1):0, (1,1):1, (1,2):2, (1,3):3, (2,3):4}
filter_tensor_indices(tensor, [1,3])
# {(0, 0): 1, (0, 1): 3}
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]])
t = p.triangulate()
v = t.get_toric_variety()
intnums_nobasis = v.intersection_numbers(in_basis=False)
intnums_inbasis = v.intersection_numbers(in_basis=True)
intnums_inbasis == filter_tensor_indices(intnums_nobasis, v.divisor_basis())
# True
```

---

### `find_new_affinely_independent_points`

**Description:**
Finds new points that are affinely independent to the input list of points.

This is useful when one wants to turn a polytope that is not
full-dimensional into one that is, without affecting the structure of the
triangulations.

**Arguments:**

- `pts`: A list of points.

**Returns:**
A list of affinely independent points with respect to the ones inputted.

**Example:**

We construct a list of points and then find a set of affinely independent
points.

```python
pts = [[1,0,1],[0,0,1],[0,1,1]]
find_new_affinely_independent_points(pts)
array([[1, 0, 2]])
```

---

### `float_to_fmpq`

**Description:**
Converts a float to an fmpq (Flint's rational number class).

See <https://flintlib.org/doc/fmpq.html>

**Arguments:**

- `c`: The input number.

**Returns:**
The rational number that most reasonably approximates the input.

**Example:**

We convert a few floats to rational numbers.

```python
from cytools.utils import float_to_fmpq
float_to_fmpq(0.1), float_to_fmpq(0.333333333333), float_to_fmpq(2.45)
# (1/10, 1/3, 49/20)
```

---

### `fmpq_to_float`

**Description:**
Converts an fmpq (Flint's rational number class) to a float.

See <https://flintlib.org/doc/fmpq.html>

**Arguments:**

- `c`: The input rational number.

**Returns:**
The number as a float.

**Example:**

We convert a few rational numbers to floats.

```python
from cytools.utils import fmpq_to_float
from flint import fmpq
fmpq_to_float(fmpq(1,2)), fmpq_to_float(fmpq(1,3)),\
                                                fmpq_to_float(fmpq(49,20))
# (0.5, 0.3333333333333333, 2.45)
```

---

### `gcd_float`

**Description:**
Compute the greatest common (floating-point) divisor of a and b. This is
simply the largest floating point number that divides a and b. Uses the
Euclidean algorithm.

Warning - unexpected/buggy behavior can occur if b starts tiny. E.g.,
gcd\_float(100,0.1,0.2) returns 100.

This only seems to be a risk if b *starts* below tol.

**Arguments:**

- `a`: The first number.
- `b`: The second number.
- `tol`: The tolerance for rounding.

**Returns:**
The gcd of a and b.

**Example:**

We compute the gcd of two floats. This function is useful since the
standard gcd functions raise an error for non-integer values.

```python
from cytools.utils import gcd_float
gcd_float(0.2, 0.5)
# Should be 0.1, but there are small rounding errors
# 0.09999999999999998
```

---

### `heights_to_kahler`

Given an h11+5 dimensional height vector,
returns an h11 dimensional vector that corresponds to point in the kahler cone.

---

### `integral_nullspace`

Returns the integral nullspace as column vectors

---

### `kahler_to_heights`

Given an h11 dimensional vector hat corresponds to point in the kahler cone,
returns an h11+5 dimensional height vector.

---

### `lattice_index`

**Description:**
Computes the index of the sublattice generated by the rows of an integer
matrix, via the Smith normal form (the product of its invariant factors).

**Arguments:**

- `mat`: An integer matrix whose rows generate the sublattice.

**Returns:**
The lattice index (an integer).

---

### `lll_reduce`

Apply lll-reduction to the input points (the rows).

**Arguments:**

- `pts`: A list of points.

**Returns:**
The reduced points (pts\_red; as rows of a numpy array).
If transform==True, also return the transformation matrix/inverse
(A, Ainv) s.t. pts\_red.T = A\*pts\_in.T. As numpy arrays.

---

### `polytope_generator`

**Description:**
Reads polytopes from a file or a string. The polytopes can be specified
with their vertices, as used in the Kreuzer-Skarke database, or from a
weight system.

**NOTE:**

This function is not intended to be called by the end user. Instead, it is
used by the [`read_polytopes`](#read_polytopes) and
[`fetch_polytopes`](#fetch_polytopes) functions.

**Arguments:**

- `input`: Specifies the name of the file to read or the string containing
  the polytopes.
- `input_type`: Specifies whether to read from a file or from the input
  string. Options are "file" or "str".
- `format`: Specifies the format to read. The options are "ks", which is
  the format used in the KS database, and "ws", if the polytopes should
  be constructed from weight systems.
- `backend`: A string that specifies the backend used for the
  [`Polytope`](https://cy.tools/docs/documentation/polytope) class.
- `deterministic_glsm_basis`: Whether to fix the GLSM basis in a
  deterministic manner. By setting this True, the GLSM/divisor bases of
  the associated Polytope/CYs should be consistent across different
  machines. If this is left as False, then bases will be computed
  identically to how they were before this flag was added.
  N.B.: the basis chosen under `deterministic_glsm_basis=True` may
  differ from the basis chosen under `deterministic_glsm_basis=False`!
- `dualize`: Flag that indicates whether to dualize all the polytopes
  before yielding them.
- `favorable`: Yield only polytopes that are favorable when set to True, or
  non-favorable when set to False. If not specified then it yields both
  favorable and non-favorable polytopes.
- `lattice`: The lattice to use when checking favorability. This parameter
  is only required when `favorable` is set. Options are "M" and "N".
- `limit`: Sets a maximum numbers of polytopes to yield.

**Returns:**
A generator of [`Polytope`](https://cy.tools/docs/documentation/polytope) objects.

**Example:**

Since this function should not be used directly, we show an example of it
being used with the [`read_polytopes`](#read_polytopes) function. We take a
string obtained from the KS database and read the polytope it specifies.

```python
from cytools import read_polytopes # Note - it cannot be imported from root
poly_data = '''4 5  M:10 5 N:376 5 H:272,2 [540]
                1    0    0    0   -9
                0    1    0    0   -6
                0    0    1    0   -1
                0    0    0    1   -1
            '''
read_polytopes(poly_data, input_type="str", as_list=True)
# [A 4-dimensional reflexive lattice polytope in ZZ^4]
```

---

### `project_heights_to_kahler`

Given an h11+5 dimensional height vector,
returns an h11+5 dimensional vector that corresponds to point in the kahler cone.

---

### `read_polytopes`

**Description:**
Reads polytopes from a file or a string. The polytopes can be specified
with their vertices, as used in the Kreuzer-Skarke database, or from a
weight system.

**Arguments:**

- `input`: Specifies the name of the file to read or the string containing
  the polytopes.
- `input_type`: Specifies whether to read from a file or from the input
  string. Options are "file" or "str".
- `format`: Specifies the format to read. The options are "ks", which is
  the format used in the KS database, and "ws", if the polytopes should
  be constructed from weight systems.
- `backend`: A string that specifies the backend used for the
  [`Polytope`](https://cy.tools/docs/documentation/polytope) class.
- `deterministic_glsm_basis`: Whether to fix the GLSM basis in a
  deterministic manner. By setting this True, the GLSM/divisor bases of
  the associated Polytope/CYs should be consistent across different
  machines. If this is left as False, then bases will be computed
  identically to how they were before this flag was added.
  N.B.: the basis chosen under `deterministic_glsm_basis=True` may
  differ from the basis chosen under `deterministic_glsm_basis=False`!
- `as_list`: Return the list of polytopes instead of a generator.
- `dualize`: Flag that indicates whether to dualize all the polytopes
  before yielding them.
- `favorable`: Yield or return only polytopes that are favorable when set
  to True, or non-favorable when set to False. If not specified then it
  yields both favorable and non-favorable polytopes.
- `lattice`: The lattice to use when checking favorability. This parameter
  is only required when `favorable` is set. Options are "M" and "N".
- `limit`: Sets a maximum numbers of polytopes to yield.

**Returns:**
A generator of [`Polytope`](https://cy.tools/docs/documentation/polytope) objects, or the full list when
`as_list` is set to True.

**Example:**

We take a string obtained from the KS database and read the polytope it
specifies.

```python
from cytools import read_polytopes # Note that it can directly be imported from the root
poly_data = '''4 5  M:10 5 N:376 5 H:272,2 [540]
                1    0    0    0   -9
                0    1    0    0   -6
                0    0    1    0   -1
                0    0    0    1   -1
            '''
read_polytopes(poly_data, input_type="str", as_list=True)
# [A 4-dimensional reflexive lattice polytope in ZZ^4]
```

---

### `set_curve_basis`

**Description:**
Specifies a basis of curves of the toric variety, which in turn specifies a
dual basis of divisors. This can be done with a vector specifying the
indices of the dual prime toric divisors or as a matrix with the rows being
the basis curves, and the entries are the intersection numbers with the
prime toric divisors. Note that when using a vector it is equivalent to
using the same vector in the [`set_divisor_basis`](#set_divisor_basis)
function.

**INFO:**

This function should generally not be called directly by the user. Instead,
it is called by the [`set_curve_basis`](https://cy.tools/docs/documentation/toricvariety#set_curve_basis)
function of the [`ToricVariety`](https://cy.tools/docs/documentation/toricvariety) class, or the
[`set_curve_basis`](https://cy.tools/docs/documentation/calabiyau#set_curve_basis) function of the
[`CalabiYau`](https://cy.tools/docs/documentation/calabiyau) class.

**NOTE:**

Only integral bases are supported by CYTools, meaning that all toric curves
must be able to be written as an integral linear combination of the basis
curves.

**Arguments:**

- `tv_or_cy`: The toric variety or Calabi-Yau whose basis will be set.
- `basis`: Vector or matrix specifying a basis. When a vector is used, the
  entries will be taken as indices of the standard basis of the dual to
  the lattice of prime toric divisors. When a matrix is used, the rows
  are taken as linear combinations of the aforementioned elements.
- `include_origin`: Whether to interpret the indexing specified by the
  input vector as including the origin.

**Returns:**
Nothing.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We consider a simple toric variety with two independent
curves. We first find the default basis of curves it picks and then set a
basis of our choice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.curve_basis() # We haven't set any basis
# array([1, 6])
v.set_curve_basis([5,6]) # Here we set a basis
v.curve_basis() # We get the basis we set
# array([5, 6])
v.curve_basis(as_matrix=True) # We get the basis in matrix form
# array([[-18,   1,   9,   6,   1,   1,   0],
#        [ -6,   0,   3,   2,   0,   0,   1]])
```

Note that when setting a curve basis in this way, the function behaves
exactly the same as [`set_divisor_basis`](#set_divisor_basis). For a more
advanced example involving generic bases these two functions differ. An
example can be found in the [experimental features](https://cy.tools/docs/documentation/experimental) section.

---

### `set_divisor_basis`

**Description:**
Specifies a basis of divisors for the toric variety or Calabi-Yau manifold,
which in turn specifies a dual basis of curves. This can be done with a
vector specifying the indices of the prime toric divisors, or as a matrix
where each row is a linear combination of prime toric divisors.

**INFO:**

This function should generally not be called directly by the user. Instead,
it is called by the [`set_divisor_basis`](https://cy.tools/docs/documentation/toricvariety#set_divisor_basis)
function of the [`ToricVariety`](https://cy.tools/docs/documentation/toricvariety) class, or the
[`set_divisor_basis`](https://cy.tools/docs/documentation/calabiyau#set_divisor_basis) function of the
[`CalabiYau`](https://cy.tools/docs/documentation/calabiyau) class.

**NOTE:**

Only integral bases are supported by CYTools, meaning that all prime toric
divisors must be able to be written as an integral linear combination of
the basis divisors.

**Arguments:**

- `tv_or_cy`: The toric variety or Calabi-Yau whose basis will be set.
- `basis`: Vector or matrix specifying a basis. When a vector is used, the
  entries will be taken as the indices of points of the polytope or prime
  divisors of the toric variety. When a matrix is used, the rows are
  taken as linear combinations of the aforementioned divisors.
- `include_origin`: Whether to interpret the indexing specified by the
  input vector as including the origin.

**Returns:**
Nothing.

**Example:**

This function is not intended to be directly used, but it is used in the
following example. We consider a simple toric variety with two independent
divisors. We first find the default basis it picks and then we set a basis
of our choice.

```python
p = Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-6,-9]])
t = p.triangulate()
v = t.get_toric_variety()
v.divisor_basis() # We haven't set any basis
# array([1, 6])
v.set_divisor_basis([5,6]) # Here we set a basis
v.divisor_basis() # We get the basis we set
# array([5, 6])
v.divisor_basis(as_matrix=True) # We get the basis in matrix form
# array([[0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 1]])
```

An example for more generic basis choices can be found in the
[experimental features](https://cy.tools/docs/documentation/experimental) section.

---

### `solve_linear_system`

**Description:**
Solves the sparse linear system M\*x + C = 0.

**Arguments:**

- `M`: The matrix.
- `C`: The constant term.
- `backend`: The solver to use. Options are "all", "sksparse" and "scipy".
  When set to "all" it tries all available backends.
- `check`: Whether to explicitly check the solution to the linear system.
- `backend_error_tol`: Error tolerance for the solution.
- `verbosity`: The verbosity level.
  - verbosity = 0: Do not print anything.
  - verbosity = 1: Print warnings when backends fail.

**Returns:**
Floating-point solution to the linear system.

**Example:**

We solve a very simple linear equation.

```python
from cytools.utils import to_sparse, solve_linear_system
id_array = [[0,0,1],[1,1,1],[2,2,1],[3,3,1],[4,4,1]]
M = to_sparse(id_array, sparse_type="csr")
C = [1,1,1,1,1]
solve_linear_system(M, C)
# array([-1., -1., -1., -1., -1.])
```

---

### `symmetric_dense_to_sparse`

**Description:**
Converts a dense symmetric tensor to a sparse tensor of the form
{(a,b,...,c):M\_ab...c, ...}.

The upper triangular indices are used. That is, a<=b<=...<=c.

Optionally, it applies a basis transformation.

**Arguments:**

- `tensor`: A dense symmetric tensor.
- `basis`: A matrix where the rows are the basis elements.

**Returns:**
A sparse tensor of the form {(a,b,...,c):M\_ab...c, ...}.

**Example:**

We construct a simple tensor and then convert it to a dense array. We
consider the same example as for the
[`filter_tensor_indices`](#filter_tensor_indices) function, but now we have
to specify the basis in matrix form.

```python
from cytools.utils import symmetric_dense_to_sparse
tensor = [[1,2],[2,3]]
symmetric_dense_to_sparse(tensor)
# {(0, 0): 1, (0, 1): 2, (1, 1): 3}
```

---

### `symmetric_sparse_to_dense`

**Description:**
Converts a symmetric sparse tensor of the form {(a,b,...,c): M\_ab...c, ...}
to a dense tensor.

Optionally, it then applies a basis transformation.

**Arguments:**

- `tensor`: A sparse tensor of the form {(a,b,...,c):M\_ab...c, ...}.
- `basis`: A matrix where the rows are the basis elements.

**Returns:**
A dense tensor.

**Example:**

We construct a simple tensor and then convert it to a dense array. We
consider the same example as for the
[`filter_tensor_indices`](#filter_tensor_indices) function, but now we have
to specify the basis in matrix form.

```python
from cytools.utils import symmetric_sparse_to_dense_in_basis
tensor = {(0,1):0, (1,1):1, (1,2):2, (1,3):3, (2,3):4}
basis = [[0,1,0,0],[0,0,0,1]]
symmetric_sparse_to_dense(tensor, basis)
# array([[1, 3],
#        [3, 0]])
```

---

### `to_sparse`

**Description:**
Converts a (manually implemented) sparse matrix of the form
[[a,b,M\_ab], ...] or a dictionary of the form {(a,b):M\_ab, ...} to a formal
dok\_matrix or to a csr\_matrix.

**Arguments:**

- `arr`: A list of the form [[a,b,M\_ab],...] or a dictionary of the
  form [(a,b):M\_ab,...].
- `sparse_type`: The type of sparse matrix to return. The options are "dok"
  and "csr".

**Returns:**
The sparse matrix in dok\_matrix or csr\_matrix format.

**Example:**

We convert the 5x5 identity matrix into a sparse matrix.

```python
from cytools.utils import to_sparse
id_array = [[0,0,1],[1,1,1],[2,2,1],[3,3,1],[4,4,1]]
to_sparse(id_array)
# <5x5 sparse matrix of type '<class 'numpy.float64'>'
#        with 5 stored elements in Dictionary Of Keys format>
to_sparse(id_array, sparse_type="csr")
# <5x5 sparse matrix of type '<class 'numpy.float64'>'
#        with 5 stored elements in Compressed Sparse Row format>
```

---

## Functions in `cytools.config`

### `check_mosek_license`

**Description:**
Checks if the Mosek license is valid. If it is not, it prints the reason.

**Arguments:**
None.

**Returns:**
Nothing.

**Example:**

The Mosek license should be automatically checked, but it can also be
checked as follows.

```python
import cytools
cytools.config.check_mosek_license()
# It will print an error if it is not working, and if nothing is printed
# then it is working correctly
```

---

### `enable_experimental_features`

**Description:**
Enables the experimental features of CYTools. For more information read the
[experimental features page](https://cy.tools/docs/documentation/experimental).

**Arguments:**
None.

**Returns:**
Nothing.

**Example:**

We enable the experimental features.

```python
import cytools
cytools.config.enable_experimental_features()
```

---

### `set_mosek_path`

**Description:**
Sets a custom path to the Mosek license, for when it is stored in a
non-default location on your computer. The license will be checked after
the new path is set.

**Arguments:**

- `path` *(str)*: The path to the Mosek license.

**Returns:**
Nothing.

**Example:**

```python
import cytools
cytools.config.set_mosek_path("/path/to/mosek.lic")
```

---

## Functions in `cytools.__init__`

### `check_for_updates`

**Description:**
Checks for updates of CYTools. It prints a message if a new version is
available, and displays a warning if the current version has a serious bug.

**Arguments:**
None.

**Returns:**
Nothing.

**Example:**

We check for updates of CYTools. This is done automatically, so there is
usually no need to do this.

```python
import cytools
cytools.check_for_updates()
```

---

---

# Configuration

Source: https://cy.tools/docs/documentation/config

There is a configuration submodule that allows changing a few settings for those adventurous enough to use CYTools in a non-standard way.

## Experimental Features

There are a few experimental features that are locked by default since they haven't been through enough testing. They can be enabled as follows.

```python
import cytools
cytools.config.enable_experimental_features()
```

More details can be found in the [experimental features](https://cy.tools/docs/documentation/experimental) section.

## Restricting parallelism

When running multiple scripts at the same time, it can be detrimental if each process tries to use all available CPU threads. To limit the number of CPU threads that CYTools uses you can set the `n_threads` variable, say to 1, as follows.

```python
import cytools
cytools.config.n_threads = 1
```

---

# Experimental Features

Source: https://cy.tools/docs/documentation/experimental

There are a few experimental features that are locked by default since they haven't been through enough testing. They can be enabled as follows.

```python
import cytools
cytools.config.enable_experimental_features()
```

## Calabi-Yau hypersurfaces of dimensions other than 3

There is experimental support for Calabi-Yau manifolds of dimensions other than 3. They can be constructed in the analogous way by starting with reflexive polytopes in dimensions other than 4. As the simplest example, we can construct the Calabi-Yau hypersurface in \(\mathbb{P}^5\).

```python
p = Polytope([[1,0,0,0,0],[0,1,0,0,0],[0,0,1,0,0],[0,0,0,1,0],[0,0,0,0,1],[-1,-1,-1,-1,-1]])
t = p.triangulate()
t.get_cy()
# A Calabi-Yau 4-fold hypersurface with h11=1, h12=0, h13=426, and h22=1752 in a 5-dimensional toric variety
```

Most of the functions such as the toric Mori cone or the intersection numbers should work well, but we can't guarantee that there won't be any problems.

## Toric Complete Intersection Calabi-Yaus (toric CICYs)

There is also experimental support for a much more general class of Calabi-Yau manifolds obtained as complete intersections in toric varieties. They are constructed by specifying a nef partition of the polytope. In the following example we construct a polytope, find some nef partitions, and construct the corresponding CICYs.

```python
p = Polytope([[1,0,0,0,0],[0,1,0,0,0],[0,0,1,0,0],[0,0,0,1,0],[0,0,0,0,1],[-1,0,0,0,0],[0,-1,0,0,0],[0,0,-1,0,0],[0,0,0,-1,0],[0,0,0,0,-1]])
nef_parts = p.nef_partitions() # Takes a few seconds
print(nef_parts[0]) # We print the first nef partition
# ((7, 6, 3, 4, 5), (10, 9, 8, 1, 2))
print(len(nef_parts)) # We print the number of nef partitions
# 8
t = p.triangulate()
cy0 = t.get_cy(nef_parts[0]) # Construct CY using first nef partition
print(cy0) # Print info
# A complete intersection Calabi-Yau 3-fold with h11=19 h21=19 in a 5-dimensional toric variety
cy1 = t.get_cy(nef_parts[1]) # Construct CY using second nef partition
print(cy1) # Print info
# A complete intersection Calabi-Yau 3-fold with h11=5 h21=37 in a 5-dimensional toric variety
```

Again, most of the functions such as the toric Mori cone or the intersection numbers should work well, but we can't guarantee that there won't be any problems.

## Generic bases for divisors and curves

The only kind of bases that are fully supported are those formed from a subset of prime toric divisors and such that the remaining prime toric divisors can be written as an integral linear combination. However, there is experimental support for generic bases that are specified with a matrix where each row is a linear combination of the canonical divisor, and the prime effective divisors (or the canonical divisor can be left out). There is still the requirement that all prime toric divisors must be able to be written as an integral linear combination of the basis divisors. We can see this in the following example.

```python
p = Polytope([[-1,3,-2,-1],[1,-1,0,0],[-1,0,0,1],[-1,0,0,0],[-1,0,1,1],[-1,0,2,0]])
t = p.triangulate()
cy = t.get_cy()
cy.divisor_basis() # The default basis of divisors
# Prints: array([1, 6, 7])
cy.divisor_basis(as_matrix=True) # Divisor basis in matrix form
# array([[0, 1, 0, 0, 0, 0, 0, 0],
#        [0, 0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 0, 1]])
cy.curve_basis() # The default basis of curves
# Prints: array([1, 6, 7])
cy.curve_basis(as_matrix=True) # Curves basis in matrix form
# array([[-6,  1,  3,  1, -1,  2,  0,  0],
#        [ 0,  0,  0, -1,  2, -2,  1,  0],
#        [ 0,  0,  0, -1,  1, -1,  0,  1]])
cy.divisor_basis(as_matrix=True).dot(cy.curve_basis(as_matrix=True).T) # Product is always the identity since they are dual bases
# array([[1, 0, 0],
#        [0, 1, 0],
#        [0, 0, 1]])
new_div_basis = [[0, 0, 0, 1, 0, 0, 0, 0], # Define a new basis
                 [0, 0, 0, 0, 0, 0, 1, 0],
                 [0, 0, 0, 0, 0, 0, 0, 1]]
cy.set_divisor_basis(new_div_basis)
cy.divisor_basis() # Now it returns the basis we set
# array([[0, 0, 0, 1, 0, 0, 0, 0],
#        [0, 0, 0, 0, 0, 0, 1, 0],
#        [0, 0, 0, 0, 0, 0, 0, 1]])
cy.curve_basis() # The curve basis is also changed
# array([[-6,  1,  3,  1, -1,  2,  0,  0],
#        [-6,  1,  3,  0,  1,  0,  1,  0],
#        [-6,  1,  3,  0,  0,  1,  0,  1]])
cy.divisor_basis(as_matrix=True).dot(cy.curve_basis(as_matrix=True).T) # Product remains the identity
# array([[1, 0, 0],
#        [0, 1, 0],
#        [0, 0, 1]])
new_curve_basis = cy.toric_mori_cone().extremal_rays() # Sometimes the Mori cone is simplicial and smooth, so we can use the extremal rays as a curve basis
cy.set_curve_basis(new_curve_basis)
cy.curve_basis() # Returns the new curve basis
# array([[-6,  1,  3, -1,  1,  0,  0,  2],
#        [ 0,  0,  0,  0,  1, -1,  1, -1],
#        [ 0,  0,  0,  1, -1,  1,  0, -1]])
cy.divisor_basis() # The divisor basis is changed
# array([[ 0,  1,  0,  0,  0,  0,  0,  0],
#        [ 0,  0,  0,  0,  0,  0,  1,  0],
#        [ 0,  2,  0,  0,  0,  0, -1, -1]])
cy.divisor_basis(as_matrix=True).dot(cy.curve_basis(as_matrix=True).T) # Product remains the identity
# array([[1, 0, 0],
#        [0, 1, 0],
#        [0, 0, 1]])
cy.toric_mori_cone(in_basis=True).extremal_rays() # The Mori cone is now the first orthant
# array([[1, 0, 0],
#        [0, 0, 1],
#        [0, 1, 0]])
```

One important thing to keep in mind when setting generic bases is that intersection numbers will be computed as a dense array since for a generic basis they are not sparse.

## Rational intersection numbers of singular varieties or Calabi-Yaus

By default, the intersection numbers of the ambient varieties are computed as floating-point numbers, and so are the intersection numbers of singular CYs. There is the option of transforming them into exact rational numbers. The conversion doesn't take too long, but verifying it was successful can be very slow or even run out of memory. Furthermore, the success rate and speed of the conversion decreases quickly as the number of divisors increases. Here we look at a simple example.

```python
p = Polytope([[-1,3,-2,-1],[1,-1,0,0],[-1,0,0,1],[-1,0,0,0],[-1,0,1,1],[-1,0,2,0]])
t = p.triangulate()
v = t.get_toric_variety()
intnums = v.intersection_numbers(exact_arithmetic=True)
print(intnums.get((1,2,3,4),0)) # Print intersection number D_1 \cap D_2 \cap D_3 \cap D_4. They are flint.fmpq objects
# 1/2
```

---

# License

Source: https://cy.tools/docs/documentation/license

All original CYTools code is open-source and is licensed under the [GNU General Public License version 3](https://www.gnu.org/licenses/gpl-3.0.txt).

Parts of the CYTools code are based on code snippets from the [SageMath](https://www.sagemath.org/) software package, and are redistributed under the [GNU GPLv2+ license](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt). These snippets are annotated clearly within the code. We also include a modified version of [TOPCOM](http://www.rambau.wm.uni-bayreuth.de/TOPCOM/). The original TOPCOM code by Jörg Rambau and the patch based on a [Debian package](https://packages.debian.org/sid/topcom) [[src](https://sources.debian.org/src/topcom/0.17.8+ds-2/)] by Doug Torrance are licensed under the [GPLv2+ license](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt). Further TOPCOM modifications are licensed under the [GPL3 license](https://www.gnu.org/licenses/gpl-3.0.txt).
