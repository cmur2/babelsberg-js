module('users.timfelgentreff.babelsberg.editconstraintjit').requires().toRun(function() {

Object.subclass('AbstractECJIT', {
    /**
     * Run some computationally intensive instrumentation and maintenance actions
     * regularly but not on every suggestValueHook invocation.
     * @private
     */
    doAction: function() {
        var cvarData = this.cvarData;
        // sort UUIDs descending by the count of their cvar
        var uuidByCount = Object.keys(this.cvarData).sort(function(a,b) {
            return cvarData[b]['count'] - cvarData[a]['count'];
        });

        // should optimize cvar with UUID uuidByCount[0] first, then uuidByCount[1] etc.
        var newCVar = this.cvarData[uuidByCount[0]]['cvar'];
        if(!this.currentEdit) {
            var abort = false;
            newCVar.solvers.each(function(solver) {
                if (solver.editConstraints !== undefined) {
                    if (solver.editConstraints.length > 0) abort = true;
                }
            });
            if (abort) {
                console.log("we have already a edit constraint ...");
                return;
            }
            this.createEditFor(newCVar);
        } else {
            if(this.currentEdit['cvar'] !== newCVar) {
                this.deleteEdit();
                this.createEditFor(newCVar);
            }
        }

        var expired = [];
        this.forEachCVarData(function(data) {
            data['count'] = Math.max(data['count']-this.countDecayDecrement, 0);
            if(data['count'] <= 0) {
                //expired.push(data['cvar']);
            }
        });
        expired.forEach(function(cvar) {
            console.log("Purging cvarData entry for "+cvar.__uuid__);
            delete this.cvarData[cvar.__uuid__];
        }, this);
    },

    deleteEdit: function() {
        if(this.currentEdit) {
            //console.log("Disable edit-callback for "+this.currentEdit['cvar'].__uuid__);
            this.currentEdit['cb'](); // end edit constraint
        }
        this.currentEdit = null;
    },

    createEditFor: function(cvar) {
        //console.log("Enabling edit-callback for "+cvar.__uuid__+" "+cvar.ivarname);
        this.currentEdit = {
            'cvar': cvar,
            'cb': bbb.edit(cvar.obj, [cvar.ivarname])
        };
        //this.printState();
    },

    clearState: function() {
        this.cvarData = {};
        this.actionCounter = 0;
        if(this.currentEdit) {
            this.deleteEdit();
        }
    },

    printState: function() {
        console.log("=====");
        this.forEachCVarData(function(data) {
            var cvar = data['cvar'];
            console.log("CVar(uuid:"+cvar.__uuid__+", ivarname:"+cvar.ivarname+", count:"+data['count']+")");
        });
    },

    forEachCVarData: function(callback) {
        Object.keys(this.cvarData).forEach(function(key) {
            var value = this.cvarData[key];
            callback.bind(this)(value);
        }, this);
    }
});

AbstractECJIT.subclass('ClassicECJIT', {
    name: 'classic',

    initialize: function() {
        this.actionCounterLimit = 25;
        this.countDecayDecrement = 10;
        this.clearState();
    },

    /**
     * Function used for instrumenting ConstrainedVariable#suggestValue to
     * implement automatic edit constraints. The boolean return value says
     * whether ConstrainedVariable#suggestValue may proceed normally or should
     * be terminated since an edit constraint is enabled.
     * @function EditConstraintJIT#suggestValueHook
     * @public
     * @param {Object} cvar The ConstrainedVariable on which suggestValue() was called.
     * @param {Object} value The new value which was suggested.
     * @return {Boolean} whether suggestValue should be terminated or run normally.
     */
    suggestValueHook: function(cvar, value) {
        if(!(cvar.__uuid__ in this.cvarData)) {
            //console.log("Creating cvarData entry for "+cvar.__uuid__);
            this.cvarData[cvar.__uuid__] = {
                'cvar': cvar,
                'count': 0
            };
        }
        var data = this.cvarData[cvar.__uuid__];
        data['count'] += 1;

        this.actionCounter += 1;
        if(this.actionCounter >= this.actionCounterLimit) {
            this.doAction();
            this.actionCounter = 0;
        }

        if(this.currentEdit && cvar.__uuid__ === this.currentEdit['cvar'].__uuid__) {
            this.currentEdit['cb']([value]);
            return true;
        }

        return false;
    }
});

AbstractECJIT.subclass('MultiplicativeAdaptiveECJIT', {
    name: 'mul',

    initialize: function() {
        this.actionCounterMax = 64;
        this.actionCounterMin = 2;
        this.currentActionLimit = this.actionCounterMin;
        this.countDecayDecrement = 10;
        this.clearState();
    },

    /**
     * Function used for instrumenting ConstrainedVariable#suggestValue to
     * implement automatic edit constraints. The boolean return value says
     * whether ConstrainedVariable#suggestValue may proceed normally or should
     * be terminated since an edit constraint is enabled.
     * @function EditConstraintJIT#suggestValueHook
     * @public
     * @param {Object} cvar The ConstrainedVariable on which suggestValue() was called.
     * @param {Object} value The new value which was suggested.
     * @return {Boolean} whether suggestValue should be terminated or run normally.
     */
    suggestValueHook: function(cvar, value) {
        if(!(cvar.__uuid__ in this.cvarData)) {
            //console.log("Creating cvarData entry for "+cvar.__uuid__);
            this.cvarData[cvar.__uuid__] = {
                'cvar': cvar,
                'count': 0
            };
        }
        var data = this.cvarData[cvar.__uuid__];
        data['count'] += 1;

        this.actionCounter += 1;
        //console.log("actionCounters: counter=" + this.actionCounter + " limit=" + this.currentActionLimit);
        if(this.actionCounter >= this.currentActionLimit) {
            var oldEdit = this.currentEdit;
            this.doAction();
            if ((oldEdit === undefined) || (oldEdit === this.currentEdit)) {
                this.currentActionLimit = Math.min(this.currentActionLimit * 2, this.actionCounterMax);
            } else {
                this.currentActionLimit = Math.max(this.currentActionLimit / 2, this.actionCounterMin);
            }
            this.actionCounter = 0;
        }

        if(this.currentEdit && cvar.__uuid__ === this.currentEdit['cvar'].__uuid__) {
            this.currentEdit['cb']([value]);
            return true;
        }

        return false;
    }
});
AbstractECJIT.subclass('AdditiveAdaptiveECJIT', {
    name: 'add',

    initialize: function() {
        this.actionCounterMax = 64;
        this.actionCounterMin = 2;
        this.currentActionLimit = 2 * this.actionCounterMin;
        this.countDecayDecrement = 10;
        this.clearState();
    },


    /**
     * Function used for instrumenting ConstrainedVariable#suggestValue to
     * implement automatic edit constraints. The boolean return value says
     * whether ConstrainedVariable#suggestValue may proceed normally or should
     * be terminated since an edit constraint is enabled.
     * @function EditConstraintJIT#suggestValueHook
     * @public
     * @param {Object} cvar The ConstrainedVariable on which suggestValue() was called.
     * @param {Object} value The new value which was suggested.
     * @return {Boolean} whether suggestValue should be terminated or run normally.
     */
    suggestValueHook: function(cvar, value) {
        if(!(cvar.__uuid__ in this.cvarData)) {
            //console.log("Creating cvarData entry for "+cvar.__uuid__);
            this.cvarData[cvar.__uuid__] = {
                'cvar': cvar,
                'count': 0
            };
        }
        var data = this.cvarData[cvar.__uuid__];
        data['count'] += 1;

        this.actionCounter += 1;
        if(this.actionCounter >= this.currentActionLimit) {
            this.doAction();
            this.actionCounter = 0;
        }

        if(this.currentEdit && cvar.__uuid__ === this.currentEdit['cvar'].__uuid__) {
            this.currentEdit['cb']([value]);
            if (this.currentActionLimit < this.actionCounterMax)
                this.currentActionLimit += 1;
            return true;
        } else {
            if (this.currentActionLimit > this.actionCounterMin)
                this.currentActionLimit -= 1;
        }

        return false;
    }
});

AbstractECJIT.subclass('LastECJIT', {
    name: 'last',

    initialize: function() {
        this.clearState();
    },


    /**
     * Function used for instrumenting ConstrainedVariable#suggestValue to
     * implement automatic edit constraints. The boolean return value says
     * whether ConstrainedVariable#suggestValue may proceed normally or should
     * be terminated since an edit constraint is enabled.
     * @function EditConstraintJIT#suggestValueHook
     * @public
     * @param {Object} cvar The ConstrainedVariable on which suggestValue() was called.
     * @param {Object} value The new value which was suggested.
     * @return {Boolean} whether suggestValue should be terminated or run normally.
     */
    suggestValueHook: function(cvar, value) {
        // should optimize cvar with UUID uuidByount[0] first, then uuidByCount[1] etc.
        if(!this.currentEdit) {
            var abort = false;
            cvar.solvers.each(function(solver) {
                if (solver.editConstraints !== undefined) {
                    if (solver.editConstraints.length > 0) abort = true;
                }
            });
            if (abort) {
                console.log("we have already a edit constraint ...");
                return false;
            }
            this.createEditFor(cvar);
        } else {
            if(this.currentEdit['cvar'] !== cvar) {
                this.deleteEdit();
                this.createEditFor(cvar);
            }
        }

        this.currentEdit['cb']([value]);
        return true;
    }
});

Object.subclass('EmptyECJIT', {
    name: 'empty',

    /**
     * Function used for instrumenting ConstrainedVariable#suggestValue to
     * implement automatic edit constraints. The boolean return value says
     * whether ConstrainedVariable#suggestValue may proceed normally or should
     * be terminated since an edit constraint is enabled.
     * @function EditConstraintJIT#suggestValueHook
     * @public
     * @param {Object} cvar The ConstrainedVariable on which suggestValue() was called.
     * @param {Object} value The new value which was suggested.
     * @return {Boolean} whether suggestValue should be terminated or run normally.
     */
    suggestValueHook: function(cvar, value) {
        return false;
    },

    clearState: function() {
        // Do nothing. Public interface.
    },

    printState: function() {
        console.log("==== EmptyECJIT ====");
        console.log(" Nothin' to report. ");
    }
});

Object.subclass('ECJITTests', {
    benchAll: function() {
        var names = ['clAddSim', 'dbAddSim', 'clDragSim', 'clDrag2DSim', 'clDrag2DSimFastX', 'clDrag2DSimChangeHalf', 'clDrag2DSimChangeTenth', 'clDrag2DSimFreqChange5'],
            scenarios = [
                {iter: 5}, {iter: 100} //, {iter: 500}
            ],
            executionRuns = 3;
            createEmptyECJIT = function() { return new EmptyECJIT(); },
            createECJITs = [
                function() { return new ClassicECJIT(); },
                function() { return new AdditiveAdaptiveECJIT(); },
                function() { return new MultiplicativeAdaptiveECJIT(); },
                function() { return new LastECJIT(); }
            ],
            pad = function(s, n) { return lively.lang.string.pad(s+"", n-(s+"").length); },
            padl = function(s, n) { return lively.lang.string.pad(s+"", n-(s+"").length,true); };

        console.log("====== Start benchmark ======");
        console.log("Simulations: " + names.join(", "));
        console.log("Times in ms (ec | "+createECJITs.map(function(fn) { return fn().name; }).join(" | ")+" / no-jit):");

        names.forEach(function (name) {
            scenarios.forEach(function (scenario) {
                this.bench(name, scenario.iter, createEmptyECJIT());
                createECJITs.forEach(function (fn) {
                    this.bench(name, scenario.iter, fn());
                }, this);
                this.bench(name+"Edit", scenario.iter, createEmptyECJIT());

                var t0 = this.bench(name, scenario.iter, createEmptyECJIT());
                var t1s = [];
                createECJITs.forEach(function (fn) {
                    var t1 = 0;
                    for (var i = 0; i < executionRuns; i++) {
                        t1 += this.bench(name, scenario.iter, fn());
                    }
                    t1s.push(Math.round(t1/executionRuns));
                }, this);
                var t2 = 0;
                for (var i = 0; i < executionRuns; i++) {
                    t2 += this.bench(name+"Edit", scenario.iter, createEmptyECJIT());
                }
                t2 = Math.round(t2/executionRuns);

                var output = pad(name+"("+scenario.iter+"):", 30)+" "+padl(t2,4)+" | ";
                output += t1s.map(function (t1) {
                    var speedupMsg = "";
                    if(t1 < t2) {
                        speedupMsg = "   FA ";
                    } else if(t0 < t1) {
                        speedupMsg = "   SL ";
                    } else if(t2 <= t1 && t1 < t0) {
                        speedupMsg = " ("+padl(Math.round((t1-t2)/(t0-t2)*100),2)+"%)";
                    }
                    return padl(t1,4)+pad(speedupMsg,6);
                }, this).join(" | ");
                output += " | "+padl(t0,4);

                console.log(output);
            }.bind(this));
        }.bind(this));

        console.log("====== benchmark done ======");
    },

    bench: function(name, iterations, ecjit) {
        var fn = this[name],
            old_ecjit = bbb.ecjit;

        bbb.ecjit = ecjit;

        var start = new Date();
        fn.bind(this)(iterations);
        var end = new Date();

        bbb.ecjit = old_ecjit;
        return end-start;
    },

    dbAddSim: function (iterations) {
        var o = {x: 0, y: 0, z: 0},
            solver = new DBPlanner();

        bbb.always({solver: solver, ctx: {o: o}}, function () {
            return o.x == o.z - o.y &&
                o.y == o.z - o.x &&
                o.z == o.x + o.y;
        });

        for (var i = 0; i < iterations; i++) {
            o.x = i;
            console.assert(o.x + o.y == o.z);
        }
    },

    dbAddSimEdit: function (iterations) {
        var o = {x: 0, y: 0, z: 0},
            solver = new DBPlanner();

        bbb.always({solver: solver, ctx: {o: o}}, function () {
            return o.x == o.z - o.y &&
                o.y == o.z - o.x &&
                o.z == o.x + o.y;
        });

        var cb = bbb.edit(o, ["x"]);
        for (var i = 0; i < iterations; i++) {
            cb([i]);
            console.assert(o.x + o.y == o.z);
        }
        cb();
    },

    clAddSim: function (iterations) {
        var o = {x: 0, y: 0, z: 0},
            solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: {o: o}}, function () { return o.x + o.y == o.z; });

        for (var i = 0; i < iterations; i++) {
            o.x = i;
            console.assert(o.x + o.y == o.z);
        }
    },

    clAddSimEdit: function (iterations) {
        var o = {x: 0, y: 0, z: 0},
            solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: {o: o}}, function () { return o.x + o.y == o.z; });

        var cb = bbb.edit(o, ["x"]);
        for (var i = 0; i < iterations; i++) {
            cb([i]);
            console.assert(o.x + o.y == o.z);
        }
        cb();
    },

    clDragSim: function(numIterations) {
        var ctx = {
                mouse: {location_y: 0},
                mercury: {top: 0, bottom: 0},
                thermometer: {top: 0, bottom: 0},
                temperature: {c: 0},
                gray: {top: 0, bottom: 0},
                white: {top: 0, bottom: 0},
                display: {number: 0}},
            solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return temperature.c == mercury.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return white.top == thermometer.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return white.bottom == mercury.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return gray.top == mercury.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return gray.bottom == mercury.bottom });
        bbb.always({solver: solver, ctx: ctx}, function () { return display.number == temperature.c });
        bbb.always({solver: solver, ctx: ctx}, function () { return mercury.top == mouse.location_y });
        bbb.always({solver: solver, ctx: ctx}, function () { return mercury.top <= thermometer.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return mercury.bottom == thermometer.bottom });

        for (var i = 0; i < numIterations; i++) {
            ctx.mouse.location_y = i;
            console.assert(ctx.mouse.location_y == i);
        }
    },

    clDragSimEdit: function(numIterations) {
        var ctx = {
                mouse: {location_y: 0},
                mercury: {top: 0, bottom: 0},
                thermometer: {top: 0, bottom: 0},
                temperature: {c: 0},
                gray: {top: 0, bottom: 0},
                white: {top: 0, bottom: 0},
                display: {number: 0}},
            solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return temperature.c == mercury.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return white.top == thermometer.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return white.bottom == mercury.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return gray.top == mercury.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return gray.bottom == mercury.bottom });
        bbb.always({solver: solver, ctx: ctx}, function () { return display.number == temperature.c });
        bbb.always({solver: solver, ctx: ctx}, function () { return mercury.top == mouse.location_y });
        bbb.always({solver: solver, ctx: ctx}, function () { return mercury.top <= thermometer.top });
        bbb.always({solver: solver, ctx: ctx}, function () { return mercury.bottom == thermometer.bottom });

        var cb = bbb.edit(ctx.mouse, ["location_y"]);
        for (var i = 0; i < numIterations; i++) {
            cb([i]);
            console.assert(ctx.mouse.location_y == i);
        }
        cb();
    },

    clDrag2DSimParam: function(numIterations, sheer) {
        var ctx = {
            mouse: {x: 100, y: 100},
            wnd: {w: 100, h: 100},
            comp1: {w: 70, display: 0},
            comp2: {w: 30, display: 0}
        };
        var solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.w == mouse.x });
        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.h == mouse.y });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w <= 400; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w+comp2.w == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.display == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp2.display == wnd.h; });

        for(var i = 0; i < numIterations; i++) {
            ctx.mouse.x = 100+i;
            if(i % sheer == 0) {
                ctx.mouse.y = 100+i;
            }
            console.assert(ctx.mouse.x == 100+i);
            if(i % sheer == 0) {
                console.assert(ctx.mouse.y == 100+i);
            }
        }
    },

    clDrag2DSimEditParam: function(numIterations, sheer) {
        var ctx = {
            mouse: {x: 100, y: 100},
            wnd: {w: 100, h: 100},
            comp1: {w: 70, display: 0},
            comp2: {w: 30, display: 0}
        };
        var solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.w == mouse.x });
        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.h == mouse.y });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w <= 400; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w+comp2.w == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.display == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp2.display == wnd.h; });

        var cb = bbb.edit(ctx.mouse, ["x", "y"]);
        for(var i = 0; i < numIterations; i++) {
            cb([100+i, Math.floor((100+i)/sheer)*sheer]);
            console.assert(ctx.mouse.x == 100+i);
            console.assert(ctx.mouse.y == Math.floor((100+i)/sheer)*sheer);
        }
        cb();
    },

    clDrag2DSim: function(numIterations) {
        this.clDrag2DSimParam(numIterations, 1);
    },

    clDrag2DSimEdit: function(numIterations) {
        this.clDrag2DSimEditParam(numIterations, 1);
    },

    clDrag2DSimFastX: function(numIterations) {
        this.clDrag2DSimParam(numIterations, 3);
    },

    clDrag2DSimFastXEdit: function(numIterations) {
        this.clDrag2DSimEditParam(numIterations, 3);
    },

    clDrag2DSimChangeParam: function(numIterations, numSwitch) {
        var ctx = {
            mouse: {x: 100, y: 100},
            wnd: {w: 100, h: 100},
            comp1: {w: 70, display: 0},
            comp2: {w: 30, display: 0}
        };
        var solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.w == mouse.x });
        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.h == mouse.y });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w <= 400; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w+comp2.w == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.display == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp2.display == wnd.h; });

        for(var i = 0; i < numIterations; i++) {
            if(i < numSwitch) {
                ctx.mouse.x = 100+i;
                console.assert(ctx.mouse.x == 100+i);
            } else {
                ctx.mouse.y = 100+(i-numSwitch);
                console.assert(ctx.mouse.x == numSwitch-1);
                console.assert(ctx.mouse.y == 100+(i-numSwitch));
            }
        }
    },

    clDrag2DSimChangeEditParam: function(numIterations, numSwitch) {
        var ctx = {
            mouse: {x: 100, y: 100},
            wnd: {w: 100, h: 100},
            comp1: {w: 70, display: 0},
            comp2: {w: 30, display: 0}
        };
        var solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.w == mouse.x });
        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.h == mouse.y });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w <= 400; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w+comp2.w == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.display == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp2.display == wnd.h; });

        var cb = bbb.edit(ctx.mouse, ["x"]);
        for(var i = 0; i < numIterations; i++) {
            if(i < numSwitch) {
                cb([100+i]);
                console.assert(ctx.mouse.x == 100+i);
            } else {
                if(i == numSwitch) {
                    cb();
                    cb = bbb.edit(ctx.mouse, ["y"]);
                }
                cb([100+(i-numSwitch)]);
                console.assert(ctx.mouse.x == numSwitch-1);
                console.assert(ctx.mouse.y == 100+(i-numSwitch));
            }
        }
        cb();
    },

    clDrag2DSimChangeHalf: function(numIterations) {
        this.clDrag2DSimChangeParam(numIterations, numIterations/2);
    },

    clDrag2DSimChangeHalfEdit: function(numIterations) {
        this.clDrag2DSimChangeEditParam(numIterations, numIterations/2);
    },

    clDrag2DSimChangeTenth: function(numIterations) {
        this.clDrag2DSimChangeParam(numIterations, numIterations/10);
    },

    clDrag2DSimChangeTenthEdit: function(numIterations) {
        this.clDrag2DSimChangeEditParam(numIterations, numIterations/10);
    },

    clDrag2DSimFreqChangeParam: function(numIterations, switchFreq) {
        var ctx = {
            mouse: {x: 100, y: 100},
            wnd: {w: 100, h: 100},
            comp1: {w: 70, display: 0},
            comp2: {w: 30, display: 0}
        };
        var solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.w == mouse.x });
        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.h == mouse.y });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w <= 400; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w+comp2.w == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.display == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp2.display == wnd.h; });

        for(var i = 0; i < numIterations; i++) {
            if(i % (switchFreq*2) < switchFreq) {
                ctx.mouse.x = 100+i;
                console.assert(ctx.mouse.x == 100+i);
            } else {
                ctx.mouse.y = 100+i;
                console.assert(ctx.mouse.y == 100+i);
            }
        }
    },

    clDrag2DSimFreqChangeEditParam: function(numIterations, switchFreq) {
        var ctx = {
            mouse: {x: 100, y: 100},
            wnd: {w: 100, h: 100},
            comp1: {w: 70, display: 0},
            comp2: {w: 30, display: 0}
        };
        var solver = new ClSimplexSolver();
        solver.setAutosolve(false);

        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.w == mouse.x });
        bbb.always({solver: solver, ctx: ctx}, function () { return wnd.h == mouse.y });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w <= 400; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.w+comp2.w == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp1.display == wnd.w; });
        bbb.always({solver: solver, ctx: ctx}, function () { return comp2.display == wnd.h; });

        var cb = bbb.edit(ctx.mouse, ["x", "y"]);
        for(var i = 0; i < numIterations; i++) {
            if(i % (switchFreq*2) < switchFreq) {
                cb([100+i, 100+i/(switchFreq*2)]);
                console.assert(ctx.mouse.x == 100+i);
            } else {
                cb([100+i/(switchFreq*2), 100+i]);
                console.assert(ctx.mouse.y == 100+i);
            }
        }
        cb();
    },

    clDrag2DSimFreqChange5: function(numIterations) {
        this.clDrag2DSimChangeParam(numIterations, 5);
    },

    clDrag2DSimFreqChange5Edit: function(numIterations) {
        this.clDrag2DSimChangeEditParam(numIterations, 5);
    }
});

});
