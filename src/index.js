export class SimulationError extends Error{constructor(message){super(message);this.name='SimulationError';}}

export function simulateTransient(circuit,{timeStep,duration,maxSteps=100000}={}){
  if(!Number.isFinite(timeStep)||timeStep<=0)throw new SimulationError('timeStep must be greater than zero');
  if(!Number.isFinite(duration)||duration<=0)throw new SimulationError('duration must be greater than zero');
  const steps=Math.ceil(duration/timeStep);if(steps>maxSteps)throw new SimulationError(`Simulation requires ${steps} steps; maximum is ${maxSteps}`);
  validateCircuit(circuit);
  const ground=circuit.ground??'0';const usedNodes=new Set(circuit.components.flatMap(c=>[c.from,c.to]));const nodeIds=[...usedNodes].filter(id=>id!==ground);const nodeIndex=new Map(nodeIds.map((id,i)=>[id,i]));
  const sources=circuit.components.filter(c=>c.type==='voltage-source');const sourceIndex=new Map(sources.map((c,i)=>[c.id,nodeIds.length+i]));const size=nodeIds.length+sources.length;
  const capacitorVoltage=new Map(circuit.components.filter(c=>c.type==='capacitor').map(c=>[c.id,c.initialVoltage??0]));
  const inductorCurrent=new Map(circuit.components.filter(c=>c.type==='inductor').map(c=>[c.id,c.initialCurrent??0]));
  const result={analysis:'transient',timeStep,duration:steps*timeStep,times:[],nodeVoltages:Object.fromEntries([ground,...nodeIds].map(id=>[id,[]])),componentCurrents:Object.fromEntries(circuit.components.map(c=>[c.id,[]]))};
  const ni=node=>node===ground?undefined:nodeIndex.get(node);
  for(let step=0;step<steps;step++){
    const time=(step+1)*timeStep;const A=Array.from({length:size},()=>Array(size).fill(0));const b=Array(size).fill(0);
    const stampG=(a,z,g)=>{const i=ni(a),j=ni(z);if(i!==undefined)A[i][i]+=g;if(j!==undefined)A[j][j]+=g;if(i!==undefined&&j!==undefined){A[i][j]-=g;A[j][i]-=g;}};
    const stampI=(from,to,current)=>{const i=ni(from),j=ni(to);if(i!==undefined)b[i]-=current;if(j!==undefined)b[j]+=current;};
    for(const c of circuit.components){
      if(c.type==='resistor'||c.type==='lamp')stampG(c.from,c.to,1/c.resistance);
      else if(c.type==='switch'&&c.closed)stampG(c.from,c.to,1/(c.onResistance??1e-6));
      else if(c.type==='current-source')stampI(c.from,c.to,sourceValue(c,'current',time));
      else if(c.type==='capacitor'){const g=c.capacitance/timeStep;stampG(c.from,c.to,g);stampI(c.from,c.to,-g*capacitorVoltage.get(c.id));}
      else if(c.type==='inductor'){const g=timeStep/c.inductance;stampG(c.from,c.to,g);stampI(c.from,c.to,inductorCurrent.get(c.id));}
      else if(c.type==='voltage-source'){const k=sourceIndex.get(c.id),i=ni(c.from),j=ni(c.to);if(i!==undefined){A[i][k]+=1;A[k][i]+=1;}if(j!==undefined){A[j][k]-=1;A[k][j]-=1;}b[k]=sourceValue(c,'voltage',time);}
    }
    const solution=solveLinear(A,b);const voltage=node=>node===ground?0:solution[nodeIndex.get(node)];result.times.push(time);
    for(const node of [ground,...nodeIds])result.nodeVoltages[node].push(clean(voltage(node)));
    for(const c of circuit.components){const v=voltage(c.from)-voltage(c.to);let current=0;
      if(c.type==='resistor'||c.type==='lamp')current=v/c.resistance;else if(c.type==='switch')current=c.closed?v/(c.onResistance??1e-6):0;
      else if(c.type==='current-source')current=sourceValue(c,'current',time);else if(c.type==='voltage-source')current=solution[sourceIndex.get(c.id)];
      else if(c.type==='capacitor'){current=c.capacitance*(v-capacitorVoltage.get(c.id))/timeStep;capacitorVoltage.set(c.id,v);}
      else if(c.type==='inductor'){current=inductorCurrent.get(c.id)+timeStep/c.inductance*v;inductorCurrent.set(c.id,current);}
      result.componentCurrents[c.id].push(clean(current));
    }
  }
  return result;
}

export function solveLinear(matrix,vector,tolerance=1e-12){const n=vector.length;if(n===0)return[];const a=matrix.map((row,i)=>[...row,vector[i]]);for(let col=0;col<n;col++){let pivot=col;for(let row=col+1;row<n;row++)if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;if(Math.abs(a[pivot][col])<=tolerance)throw new SimulationError('Circuit has no unique solution; check floating nodes and ideal source conflicts');[a[col],a[pivot]]=[a[pivot],a[col]];const p=a[col][col];for(let j=col;j<=n;j++)a[col][j]/=p;for(let row=0;row<n;row++){if(row===col)continue;const f=a[row][col];for(let j=col;j<=n;j++)a[row][j]-=f*a[col][j];}}return a.map(row=>row[n]);}

function sourceValue(component,field,time){const waveform=component.waveform;if(!waveform)return component[field]??0;if(waveform.type==='sine')return (waveform.offset??0)+(waveform.amplitude??1)*Math.sin(2*Math.PI*(waveform.frequency??1)*time+(waveform.phase??0));if(waveform.type==='pulse'){const period=waveform.period??1,duty=waveform.duty??0.5,delay=waveform.delay??0;if(time<delay)return waveform.low??0;return ((time-delay)%period)<period*duty?(waveform.high??1):(waveform.low??0);}throw new SimulationError(`Unsupported waveform "${waveform.type}"`);}
function validateCircuit(circuit){if(!circuit||!Array.isArray(circuit.nodes)||!Array.isArray(circuit.components))throw new SimulationError('Circuit requires nodes and components arrays');const ids=new Set(circuit.nodes.map(n=>n.id));if(!ids.has(circuit.ground??'0'))throw new SimulationError('Ground node is missing');const supported=new Set(['resistor','lamp','switch','current-source','voltage-source','capacitor','inductor']);for(const c of circuit.components){if(!supported.has(c.type))throw new SimulationError(`Unsupported component type "${c.type}"`);if(!ids.has(c.from)||!ids.has(c.to))throw new SimulationError(`${c.id} references an unknown node`);if(c.from===c.to)throw new SimulationError(`${c.id} connects a node to itself`);for(const key of ['resistance','capacitance','inductance'])if(c[key]!==undefined&&(!Number.isFinite(c[key])||c[key]<=0))throw new SimulationError(`${c.id}.${key} must be positive`);}}
function clean(value){return Math.abs(value)<1e-15?0:value;}
