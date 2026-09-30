# OpenCircuit Transient Engine

A dependency-free time-domain circuit simulator using modified nodal analysis and backward-Euler companion models.

It supports resistors, lamps, switches, capacitors, inductors, independent voltage/current sources, initial conditions, sine/pulse waveforms, node-voltage traces and component-current traces. Work limits and singular-circuit errors make it safe for educational tooling.

```js
import {simulateTransient} from '@opencircuitlabs/transient-engine';
const result=simulateTransient(circuit,{timeStep:1e-5,duration:0.01});
console.log(result.nodeVoltages.out);
```

Uses OpenCircuit Format-shaped documents and SI units. This educational solver is not intended for production sign-off. Run `npm test`. MIT licensed.
