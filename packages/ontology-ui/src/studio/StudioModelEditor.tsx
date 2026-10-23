import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, MarkerType } from '@xyflow/react';
import type { Connection, Node, NodeChange, ReactFlowInstance } from '@xyflow/react';
import { Plus, Redo2, Search, Trash2, Undo2, X } from 'lucide-react';
import { modelIri, STUDIO_HISTORY_LIMIT } from '@sudowork/ontology-common';
import type { IOntologyConsistencyIssue, IOntologyStudioModel, IOntologyObjectDraft, IOntologyAttributeDraft, IOntologyRelationDraft, IOntologySemanticDocument } from '@sudowork/ontology-common';
import '@xyflow/react/dist/style.css';
import styles from './studio.module.css';

interface IOntologyNodeData extends Record<string, unknown> {
  name: string;
  attributes: number;
  isChanged?: boolean;
  onSelect: () => void;
}
const nodeTypes = { ontology: OntologyNode };
const LAYOUT_COLUMN_GAP = 340;
const LAYOUT_ROW_GAP = 150;

export function ontologyGraphLayout(objects: IOntologyObjectDraft[], relations: IOntologyRelationDraft[]): Record<string, { x: number; y: number }> {
  const objectIds = new Set(objects.map((object) => object.id));
  const incoming = new Map(objects.map((object) => [object.id, [] as string[]]));
  const outgoing = new Map(objects.map((object) => [object.id, [] as string[]]));
  const indegree = new Map(objects.map((object) => [object.id, 0]));
  for (const relation of relations) {
    if (relation.fromObjectId === relation.toObjectId || !objectIds.has(relation.fromObjectId) || !objectIds.has(relation.toObjectId)) continue;
    outgoing.get(relation.fromObjectId)?.push(relation.toObjectId);
    incoming.get(relation.toObjectId)?.push(relation.fromObjectId);
    indegree.set(relation.toObjectId, (indegree.get(relation.toObjectId) || 0) + 1);
  }
  const depth = new Map<string, number>();
  const queue = objects.filter((object) => indegree.get(object.id) === 0).map((object) => object.id);
  queue.forEach((id) => depth.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    for (const target of outgoing.get(source) || []) {
      depth.set(target, Math.max(depth.get(target) || 0, (depth.get(source) || 0) + 1));
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  const finalDepth = Math.max(0, ...depth.values());
  objects.forEach((object) => {
    if (!depth.has(object.id)) depth.set(object.id, finalDepth + 1);
  });
  const layers = new Map<number, IOntologyObjectDraft[]>();
  objects.forEach((object) => {
    const level = depth.get(object.id) || 0;
    layers.set(level, [...(layers.get(level) || []), object]);
  });
  const objectIndex = new Map(objects.map((object, index) => [object.id, index]));
  for (const [level, layer] of layers) {
    if (level === 0) continue;
    layer.sort((left, right) => {
      const parentIndex = (id: string) => {
        const parents = incoming.get(id) || [];
        return parents.length ? parents.reduce((total, parent) => total + (objectIndex.get(parent) || 0), 0) / parents.length : objectIndex.get(id) || 0;
      };
      return parentIndex(left.id) - parentIndex(right.id);
    });
  }
  const maxRows = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  return Object.fromEntries(
    [...layers.entries()].flatMap(([level, layer]) =>
      layer.map((object, index) => [
        object.id,
        {
          x: level * LAYOUT_COLUMN_GAP,
          y: (index + (maxRows - layer.length) / 2) * LAYOUT_ROW_GAP,
        },
      ])
    )
  );
}

function OntologyNode({ data }: IOntologyNodeProps) {
  const { t } = useTranslation();
  return (
    <div className={`${styles['ontology-node']} ${data.isChanged ? styles['ontology-node-changed'] : ''}`}>
      <Handle type='target' position={Position.Left} />
      <Button type='text' className={styles['ontology-node-button']} onClick={data.onSelect}>
        <span className={styles['ontology-node-content']}>
          <span className={styles['ontology-node-name']}>{data.name}</span>
          <span className={styles['ontology-node-meta']}>{t('ontology.studio.attributeCount', { count: data.attributes })}</span>
        </span>
      </Button>
      <Handle type='source' position={Position.Right} />
    </div>
  );
}

export default function StudioModelEditor({ workspaceId, model, document, onChange, onContext, onEditingChange, focusObjectId, focusIssue }: IStudioModelEditorProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<'graph' | 'structure'>('graph');
  const [search, setSearch] = useState('');
  const [nodes, setNodes] = useState<Node<IOntologyNodeData>[]>([]);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const flowRef = useRef<ReactFlowInstance<Node<IOntologyNodeData>> | null>(null);
  const [objectEditor, setObjectEditor] = useState<IOntologyObjectDraft | 'new'>();
  const [attributeEditor, setAttributeEditor] = useState<IOntologyAttributeDraft | 'new'>();
  const [relationEditor, setRelationEditor] = useState<IOntologyRelationDraft>();
  const [history, setHistory] = useState<IOntologyStudioModel[]>([structuredClone(model)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const localModel = useRef(JSON.stringify(model));
  const [objectForm] = Form.useForm();
  const [attributeForm] = Form.useForm();
  const [relationForm] = Form.useForm();
  const lastFocusIssue = useRef<IOntologyConsistencyIssue | undefined>(undefined);
  const selected = model.objects.find((object) => object.id === selectedId);
  const label = useCallback((key: string) => t(`ontology.studio.${key}`), [t]);
  const automaticLayout = useMemo(() => ontologyGraphLayout(model.objects, model.relations), [model.objects, model.relations]);

  useEffect(() => {
    try {
      positionsRef.current = JSON.parse(localStorage.getItem(`ontology-studio:layout:${workspaceId}`) || '{}');
    } catch {
      positionsRef.current = {};
    }
  }, [workspaceId]);
  useEffect(() => {
    if (JSON.stringify(model) !== localModel.current) {
      setHistory([structuredClone(model)]);
      setHistoryIndex(0);
      localModel.current = JSON.stringify(model);
    }
  }, [model]);
  useEffect(() => {
    setNodes((previous) =>
      model.objects.map((object, index) => ({
        id: object.id,
        type: 'ontology',
        position: previous.find((node) => node.id === object.id)?.position || positionsRef.current[object.id] || automaticLayout[object.id] || { x: 0, y: index * LAYOUT_ROW_GAP },
        selected: object.id === selectedId,
        data: {
          name: object.name,
          attributes: object.attributes.length,
          isChanged: previous.length > 0 && (!previous.some((node) => node.id === object.id) || previous.find((node) => node.id === object.id)?.data.name !== object.name || previous.find((node) => node.id === object.id)?.data.attributes !== object.attributes.length),
          onSelect: () => setSelectedId(object.id),
        },
        style: search && !`${object.name} ${object.code} ${object.iri}`.toLowerCase().includes(search.toLowerCase()) ? { opacity: 0.3 } : undefined,
      }))
    );
  }, [automaticLayout, model.objects, selectedId, search]);
  const edges = useMemo(
    () =>
      model.relations.map((relation) => ({
        id: relation.id,
        source: relation.fromObjectId,
        target: relation.toObjectId,
        label: relation.semanticType === 'inheritance' ? t('ontology.studio.inheritance') : relation.name,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
        labelStyle: { fontSize: 12 },
        style: relation.semanticType === 'inheritance' ? { strokeDasharray: '5 4' } : undefined,
      })),
    [model.relations, t]
  );
  const onEdit = (next: IOntologyStudioModel) => {
    const items = [...history.slice(0, historyIndex + 1), structuredClone(next)].slice(-STUDIO_HISTORY_LIMIT);
    setHistory(items);
    setHistoryIndex(items.length - 1);
    localModel.current = JSON.stringify(next);
    onChange(next);
  };
  const onHistory = (index: number) => {
    if (!history[index]) return;
    setHistoryIndex(index);
    const next = structuredClone(history[index]);
    localModel.current = JSON.stringify(next);
    onChange(next);
  };
  const onOpenObject = (object?: IOntologyObjectDraft) => {
    objectForm.resetFields();
    objectForm.setFieldsValue(object || { name: '', description: '' });
    setObjectEditor(object || 'new');
  };
  const onSaveObject = async () => {
    const values = await objectForm.validate().catch((): undefined => undefined);
    if (!values) return;
    const prior = objectEditor !== 'new' ? objectEditor : undefined;
    const id = prior?.id || crypto.randomUUID();
    const next: IOntologyObjectDraft = {
      id,
      iri: prior?.iri || modelIri(workspaceId, id),
      code: prior?.code || `object_${id.slice(0, 8)}`,
      name: values.name.trim(),
      description: values.description || '',
      tier: 1,
      status: 'active',
      sourceAssetIds: [],
      attributes: [],
      reviewDecision: 'pending',
      ...prior,
      ...values,
      updatedAt: Date.now(),
    };
    onEdit({ ...model, objects: prior ? model.objects.map((item) => (item.id === id ? next : item)) : [...model.objects, next] });
    setSelectedId(id);
    setObjectEditor(undefined);
  };
  const onOpenAttribute = (attribute?: IOntologyAttributeDraft) => {
    attributeForm.resetFields();
    attributeForm.setFieldsValue(attribute ? { ...attribute, isIdentifier: attribute.isIdentifier ? 'yes' : 'no' } : { name: '', dataType: 'string', required: false });
    setAttributeEditor(attribute || 'new');
  };
  const onSaveAttribute = async () => {
    if (!selected) return;
    const values = await attributeForm.validate().catch((): undefined => undefined);
    if (!values) return;
    const prior = attributeEditor !== 'new' ? attributeEditor : undefined;
    const id = prior?.id || crypto.randomUUID();
    const attribute: IOntologyAttributeDraft = { ...prior, ...values, id, iri: prior?.iri || modelIri(workspaceId, id), code: values.code?.trim() || prior?.code || `field_${id.slice(0, 8)}`, required: values.required === true, isIdentifier: values.isIdentifier === 'yes' };
    const attributes = prior ? selected.attributes.map((item) => (item.id === id ? attribute : item)) : [...selected.attributes, attribute];
    onEdit({ ...model, objects: model.objects.map((item) => (item.id === selected.id ? { ...item, attributes, updatedAt: Date.now() } : item)) });
    setAttributeEditor(undefined);
  };
  const onOpenRelation = (relation: IOntologyRelationDraft) => {
    relationForm.resetFields();
    relationForm.setFieldsValue(relation);
    setRelationEditor(relation);
  };
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const id = crypto.randomUUID();
    onOpenRelation({
      id,
      iri: modelIri(workspaceId, id),
      code: `relation_${id.slice(0, 8)}`,
      name: '',
      fromObjectId: connection.source,
      toObjectId: connection.target,
      cardinality: 'unspecified',
      relationType: 'object_property',
      semanticType: 'association',
      isAcyclic: false,
      reviewDecision: 'pending',
      updatedAt: Date.now(),
    });
  };
  const onSaveRelation = async () => {
    if (!relationEditor) return;
    const values = await relationForm.validate().catch((): undefined => undefined);
    if (!values) return;
    const relation = { ...relationEditor, ...values, updatedAt: Date.now() };
    const isExisting = model.relations.some((item) => item.id === relation.id);
    onEdit({ ...model, relations: isExisting ? model.relations.map((item) => (item.id === relation.id ? relation : item)) : [...model.relations, relation] });
    setRelationEditor(undefined);
  };
  const onDeleteObject = () => {
    if (!selected) return;
    Modal.confirm({
      title: label('deleteObject'),
      content: label('deleteObjectHint'),
      onOk: () => {
        onEdit({ objects: model.objects.filter((item) => item.id !== selected.id), relations: model.relations.filter((item) => item.fromObjectId !== selected.id && item.toObjectId !== selected.id) });
        setSelectedId(undefined);
      },
    });
  };
  const onNodesChange = (changes: NodeChange<Node<IOntologyNodeData>>[]) => setNodes((current) => applyNodeChanges(changes, current));
  const onPersistLayout = () => {
    positionsRef.current = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    localStorage.setItem(`ontology-studio:layout:${workspaceId}`, JSON.stringify(positionsRef.current));
  };
  const onLayout = () => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: automaticLayout[node.id] || node.position,
      }))
    );
    positionsRef.current = automaticLayout;
    localStorage.setItem(`ontology-studio:layout:${workspaceId}`, JSON.stringify(automaticLayout));
    requestAnimationFrame(() => void flowRef.current?.fitView({ padding: 0.18, duration: 250 }));
  };
  const isObjectModalOpen = objectEditor !== undefined;
  const isAttributeModalOpen = attributeEditor !== undefined;
  useEffect(() => {
    onEditingChange(isObjectModalOpen || isAttributeModalOpen || !!relationEditor);
    return () => onEditingChange(false);
  }, [isObjectModalOpen, isAttributeModalOpen, relationEditor, onEditingChange]);
  useEffect(() => {
    if (focusObjectId) setSelectedId(focusObjectId);
  }, [focusObjectId]);
  useEffect(() => {
    if (!focusIssue || focusIssue === lastFocusIssue.current) return;
    lastFocusIssue.current = focusIssue;
    if (focusIssue.targetType === 'relation') {
      const relation = model.relations.find((item) => item.id === focusIssue.targetId);
      if (relation) {
        relationForm.resetFields();
        relationForm.setFieldsValue(relation);
        setRelationEditor(relation);
      }
    }
  }, [focusIssue, model.relations, relationForm]);

  return (
    <section
      className={styles['ontology-model-editor']}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input,textarea,[contenteditable]')) {
          event.preventDefault();
          onHistory(historyIndex + (event.shiftKey ? 1 : -1));
        }
      }}
    >
      <div className={styles['ontology-toolbar']}>
        <Space>
          <Button type={view === 'graph' ? 'primary' : 'text'} onClick={() => setView('graph')}>
            {label('graph')}
          </Button>
          <Button type={view === 'structure' ? 'primary' : 'text'} onClick={() => setView('structure')}>
            {label('structure')}
          </Button>
        </Space>
        <Space wrap>
          <Input aria-label={label('searchModel')} placeholder={label('searchModel')} prefix={<Search size={14} />} value={search} onChange={setSearch} style={{ width: 160 }} />
          <Button icon={<Undo2 size={16} />} aria-label={label('undo')} disabled={historyIndex === 0} onClick={() => onHistory(historyIndex - 1)} />
          <Button icon={<Redo2 size={16} />} aria-label={label('redo')} disabled={historyIndex === history.length - 1} onClick={() => onHistory(historyIndex + 1)} />
          <Button onClick={onLayout}>{label('layout')}</Button>
          <Button type='primary' icon={<Plus size={14} />} onClick={() => onOpenObject()}>
            {label('addObject')}
          </Button>
          <Button disabled={!model.objects.length} onClick={() => onConnect({ source: selectedId || model.objects[0]?.id, target: model.objects[1]?.id || model.objects[0]?.id, sourceHandle: null, targetHandle: null })}>
            {label('addRelation')}
          </Button>
        </Space>
      </div>
      <div className={styles['ontology-canvas-area']}>
        <div className={styles['ontology-canvas']}>
          {view === 'graph' ? (
            <ReactFlow
              proOptions={{ hideAttribution: true }}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeDragStop={onPersistLayout}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onNodeDoubleClick={(_event, node) => onOpenObject(model.objects.find((item) => item.id === node.id))}
              onEdgeClick={(_event, edge) => {
                const relation = model.relations.find((item) => item.id === edge.id);
                if (relation) onOpenRelation(relation);
              }}
              onConnect={onConnect}
              onInit={(instance) => {
                flowRef.current = instance;
              }}
              fitView
              minZoom={0.15}
              maxZoom={2}
              deleteKeyCode={null}
              colorMode='system'
            >
              <Background />
              <Controls showInteractive={false} aria-label={label('graphControls')} />
              {nodes.length > 8 && <MiniMap pannable zoomable />}
              {!model.objects.length && (
                <div className={styles['ontology-canvas-empty']}>
                  <Empty description={label('emptyModel')} />
                  <Button type='primary' onClick={() => onOpenObject()}>
                    {label('addObject')}
                  </Button>
                </div>
              )}
            </ReactFlow>
          ) : (
            <div className={styles['ontology-structure']}>
              <Table
                rowKey='id'
                data={model.objects.filter((item) => `${item.name} ${item.iri}`.toLowerCase().includes(search.toLowerCase()))}
                scroll={{ x: 760 }}
                columns={[
                  {
                    title: label('name'),
                    dataIndex: 'name',
                    width: 200,
                    render: (_value, record) => (
                      <Button type='text' onClick={() => setSelectedId(record.id)}>
                        {record.name}
                      </Button>
                    ),
                  },
                  { title: 'IRI', dataIndex: 'iri', width: 460 },
                  { title: label('attributes'), width: 100, render: (_value, record) => record.attributes.length },
                ]}
              />
              <Typography.Title heading={6}>{label('relations')}</Typography.Title>
              <Table
                rowKey='id'
                data={model.relations}
                scroll={{ x: 720 }}
                columns={[
                  {
                    title: label('name'),
                    width: 360,
                    render: (_value, record) => (
                      <Button type='text' onClick={() => onOpenRelation(record)}>
                        {record.name}
                      </Button>
                    ),
                  },
                  { title: label('from'), width: 180, render: (_value, record) => model.objects.find((item) => item.id === record.fromObjectId)?.name },
                  { title: label('to'), width: 180, render: (_value, record) => model.objects.find((item) => item.id === record.toObjectId)?.name },
                ]}
              />
              <Typography.Text type='secondary'>{label('preservedAxioms')}</Typography.Text>
              <pre className={styles['ontology-code']}>{JSON.stringify(document?.statements || [], null, 2)}</pre>
            </div>
          )}
        </div>
        {selected && (
          <aside className={styles['ontology-inspector']}>
            <div className={styles['ontology-toolbar']}>
              <Typography.Title heading={6}>{selected.name}</Typography.Title>
              <Button type='text' icon={<X size={16} />} aria-label={label('close')} onClick={() => setSelectedId(undefined)} />
            </div>
            <div className={styles['ontology-inspector-content']}>
              <p>{selected.description}</p>
              <Space wrap>
                <Button onClick={() => onOpenObject(selected)}>{label('edit')}</Button>
                <Button onClick={() => onContext(selected.id)}>{label('addContext')}</Button>
                <Button status='danger' icon={<Trash2 size={14} />} onClick={onDeleteObject}>
                  {label('delete')}
                </Button>
              </Space>
              <div className={styles['ontology-section-heading']}>
                <Typography.Title heading={6}>{label('attributes')}</Typography.Title>
                <Button type='text' icon={<Plus size={14} />} onClick={() => onOpenAttribute()}>
                  {label('add')}
                </Button>
              </div>
              {selected.attributes.map((attribute) => (
                <div className={styles['ontology-attribute']} key={attribute.id}>
                  <Button type='text' onClick={() => onOpenAttribute(attribute)}>
                    {attribute.name}
                  </Button>
                  <Tag>{attribute.dataType}</Tag>
                  <Button
                    type='text'
                    status='danger'
                    aria-label={`${label('delete')} ${attribute.name}`}
                    onClick={() => onEdit({ ...model, objects: model.objects.map((item) => (item.id === selected.id ? { ...item, attributes: item.attributes.filter((attr) => attr.id !== attribute.id) } : item)) })}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
      <Modal title={label(objectEditor === 'new' ? 'addObject' : 'editObject')} visible={isObjectModalOpen} onCancel={() => setObjectEditor(undefined)} onOk={onSaveObject} unmountOnExit>
        <Form form={objectForm} layout='vertical'>
          <Form.Item field='name' label={label('name')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: label('name') }) }]}>
            <Input />
          </Form.Item>
          <Form.Item field='description' label={label('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={label('editAttribute')} visible={isAttributeModalOpen} onCancel={() => setAttributeEditor(undefined)} onOk={onSaveAttribute} unmountOnExit>
        <Form form={attributeForm} layout='vertical'>
          <Form.Item field='name' label={label('name')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: label('name') }) }]}>
            <Input />
          </Form.Item>
          <Form.Item field='code' label={label('code')}>
            <Input />
          </Form.Item>
          <Form.Item field='dataType' label={label('dataType')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: label('dataType') }) }]}>
            <Select allowCreate options={['string', 'integer', 'decimal', 'double', 'boolean', 'date', 'dateTime']} />
          </Form.Item>
          <Form.Item field='isIdentifier' label={label('identifier')}>
            <Select
              options={[
                { label: label('yes'), value: 'yes' },
                { label: label('no'), value: 'no' },
              ]}
            />
          </Form.Item>
          <Form.Item field='description' label={label('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={label('editRelation')}
        visible={!!relationEditor}
        onCancel={() => setRelationEditor(undefined)}
        onOk={onSaveRelation}
        unmountOnExit
        footer={
          <Space>
            <Button
              status='danger'
              onClick={() => {
                onEdit({ ...model, relations: model.relations.filter((item) => item.id !== relationEditor?.id) });
                setRelationEditor(undefined);
              }}
            >
              {label('delete')}
            </Button>
            <Button onClick={() => setRelationEditor(undefined)}>{label('cancel')}</Button>
            <Button type='primary' onClick={() => void onSaveRelation()}>
              {label('apply')}
            </Button>
          </Space>
        }
      >
        <Form form={relationForm} layout='vertical'>
          <Form.Item field='name' label={label('name')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: label('name') }) }]}>
            <Input />
          </Form.Item>
          <Form.Item field='fromObjectId' label={label('from')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: label('from') }) }]}>
            <Select options={model.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='toObjectId' label={label('to')} rules={[{ required: true, message: t('ontology.studio.requiredField', { field: label('to') }) }]}>
            <Select options={model.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='semanticType' label={label('relationKind')}>
            <Select
              options={[
                { label: label('association'), value: 'association' },
                { label: label('inheritance'), value: 'inheritance' },
              ]}
            />
          </Form.Item>
          <Form.Item field='cardinality' label={label('cardinality')}>
            <Select options={['unspecified', 'one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'].map((value) => ({ label: label(value), value }))} />
          </Form.Item>
          <Form.Item field='description' label={label('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

interface IStudioModelEditorProps {
  workspaceId: string;
  model: IOntologyStudioModel;
  document?: IOntologySemanticDocument;
  onEditingChange: (isEditing: boolean) => void;
  focusObjectId?: string;
  focusIssue?: IOntologyConsistencyIssue;
  onChange: (model: IOntologyStudioModel) => void;
  onContext: (objectId: string) => void;
}

interface IOntologyNodeProps {
  data: IOntologyNodeData;
}
