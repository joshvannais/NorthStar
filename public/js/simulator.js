const services = [
  {name:"Tree removal",icon:"🌳",scenarios:[
    {label:"Single small tree",trees:1,height:25,nearHouse:false,stump:false,emergency:false},
    {label:"Large oak removal",trees:1,height:55,nearHouse:true,stump:true,emergency:false},
    {label:"Multiple dead pines",trees:3,height:45,nearHouse:false,stump:true,emergency:false},
    {label:"Emergency storm cleanup",trees:2,height:40,nearHouse:true,stump:false,emergency:true},
    {label:"Overgrown lot clearing",trees:5,height:30,nearHouse:false,stump:false,emergency:false}]},
  {name:"Roof inspection/replacement",icon:"🏠",scenarios:[
    {label:"Asphalt shingle tear-off replace",sqft:1800,pitch:"moderate",layers:1,material:"asphalt"},
    {label:"Metal roof install",sqft:2400,pitch:"steep",layers:2,material:"metal"},
    {label:"Minor leak repair",sqft:0,pitch:"low",layers:1,material:"patch"},
    {label:"Architectural shingle replacement",sqft:2000,pitch:"moderate",layers:1,material:"architectural"},
    {label:"Flat roof repair reseal",sqft:1500,pitch:"low",layers:1,material:"torch-down"}]},
  {name:"Emergency plumbing",icon:"🔧",scenarios:[
    {label:"Burst pipe repair",pipeType:"copper",accessibility:"easy",emergency:true,replace:false},
    {label:"Water heater replacement 50gal",pipeType:"copper",accessibility:"easy",emergency:false,replace:true},
    {label:"Main sewer line snake",pipeType:"cast-iron",accessibility:"moderate",emergency:true,replace:false},
    {label:"Full bathroom repipe",pipeType:"galvanized",accessibility:"hard",emergency:false,replace:true},
    {label:"Faucet drain repair",pipeType:"pvc",accessibility:"easy",emergency:false,replace:false}]},
  {name:"Electrical panel upgrade",icon:"⚡",scenarios:[
    {label:"Panel upgrade 100to200A",amperage:200,outdoor:false,permit:true,emergency:false},
    {label:"Sub-panel install",amperage:100,outdoor:false,permit:true,emergency:false},
    {label:"Breaker replacement",amperage:0,outdoor:false,permit:false,emergency:true},
    {label:"Whole house rewiring",amperage:200,outdoor:true,permit:true,emergency:false},
    {label:"Lighting fixture install 6",amperage:0,outdoor:false,permit:false,emergency:false}]},
  {name:"Landscape design",icon:"🌿",scenarios:[
    {label:"Front yard redesign",sqft:1200,patio:false,plantings:true,hardscape:false,irrigation:true},
    {label:"Patio walkway install",sqft:400,patio:true,plantings:false,hardscape:true,irrigation:false},
    {label:"Full backyard transformation",sqft:2500,patio:true,plantings:true,hardscape:true,irrigation:true},
    {label:"Planting mulching",sqft:800,patio:false,plantings:true,hardscape:false,irrigation:false},
    {label:"Retaining wall drainage",sqft:0,patio:false,plantings:false,hardscape:true,irrigation:false}]},
  {name:"HVAC repair",icon:"❄️",scenarios:[
    {label:"AC capacitor replacement",system:"ac",repair:true,tonnage:3,refrigerant:"r410a"},
    {label:"Full AC system replacement",system:"ac",repair:false,tonnage:3,refrigerant:"r410a"},
    {label:"Furnace blower motor",system:"furnace",repair:true,tonnage:0,refrigerant:"none"},
    {label:"Heat pump replacement",system:"heat-pump",repair:false,tonnage:4,refrigerant:"r410a"},
    {label:"Ductwork cleaning sealing",system:"duct",repair:true,tonnage:0,refrigerant:"none"}]},
  {name:"Gutter cleaning",icon:"🍂",scenarios:[
    {label:"Single story gutters",linearFt:120,stories:1,debris:"leaves"},
    {label:"Two story gutters downspouts",linearFt:200,stories:2,debris:"leaves"},
    {label:"Heavy debris gutter guards",linearFt:160,stories:2,debris:"heavy"},
    {label:"Gutter repair clean",linearFt:100,stories:1,debris:"leaves"}]},
  {name:"Pest control",icon:"🐛",scenarios:[
    {label:"Ant infestation treatment",sqft:2000,treatment:"general",severity:"moderate"},
    {label:"Termite inspection treatment",sqft:2500,treatment:"termite",severity:"severe"},
    {label:"Rodent exclusion",sqft:1800,treatment:"rodent",severity:"moderate"},
    {label:"Quarterly pest prevention",sqft:2000,treatment:"general",severity:"low"}]},
  {name:"Concrete driveway",icon:"🏗️",scenarios:[
    {label:"New driveway 2car",sqft:600,demolition:false,reinforced:true,finish:"broom"},
    {label:"Replace existing driveway",sqft:550,demolition:true,reinforced:true,finish:"stamp"},
    {label:"Walkway patio",sqft:350,demolition:false,reinforced:false,finish:"broom"},
    {label:"Commercial slab",sqft:1000,demolition:true,reinforced:true,finish:"smooth"}]},
  {name:"Fence installation",icon:"🚧",scenarios:[
    {label:"Privacy fence wood",linearFt:150,material:"wood",gates:1,terrain:"flat"},
    {label:"Vinyl fence",linearFt:200,material:"vinyl",gates:2,terrain:"flat"},
    {label:"Chain-link fence",linearFt:180,material:"chain-link",gates:1,terrain:"slight-slope"},
    {label:"Split rail wire",linearFt:300,material:"split-rail",gates:0,terrain:"moderate-slope"}]},
  {name:"Window replacement",icon:"",scenarios:[
    {label:"Double hung 6 windows",count:6,pane:"double",story:1},
    {label:"Triple pane energy eff 4 windows",count:4,pane:"triple",story:1},
    {label:"Bay window install",count:1,pane:"double",story:1},
    {label:"Full house replacement 12 windows",count:12,pane:"double",story:2}]},
  {name:"Carpet cleaning",icon:"🧹",scenarios:[
    {label:"Living room hallway",rooms:2,sqft:500,stains:false,stairs:false},
    {label:"Full house 4 rooms stairs",rooms:4,sqft:1200,stains:true,stairs:true},
    {label:"Stain treatment focus",rooms:1,sqft:300,stains:true,stairs:false},
    {label:"Office carpet refresh",rooms:3,sqft:800,stains:false,stairs:false}]},
  {name:"Pressure washing",icon:"💦",scenarios:[
    {label:"Driveway only",sqft:500,surface:"driveway",level:"normal"},
    {label:"House exterior",sqft:1800,surface:"house",level:"normal"},
    {label:"Driveway house walkways",sqft:2200,surface:"both",level:"heavy"},
    {label:"Deck patio cleaning",sqft:400,surface:"deck",level:"normal"}]},
  {name:"Interior Painting",icon:"🎨",scenarios:[
    {label:"Single room accent",rooms:1,wallSqft:400,ceilingHeight:8,trim:false,grade:"economy",colorChange:false},
    {label:"Full house interior",rooms:5,wallSqft:2000,ceilingHeight:8,trim:true,grade:"premium",colorChange:true},
    {label:"Kitchen cabinets",rooms:1,wallSqft:300,ceilingHeight:8,trim:true,grade:"premium",colorChange:true},
    {label:"Ceiling texture",rooms:3,wallSqft:0,ceilingHeight:8,trim:false,grade:"economy",colorChange:false},
    {label:"Exterior trim painting",rooms:0,wallSqft:800,ceilingHeight:10,trim:true,grade:"premium",colorChange:true}]},
  {name:"Drywall Repair/Installation",icon:"🧱",scenarios:[
    {label:"Small patch repair",patchType:"small",sqft:5,textureMatch:false,waterDamage:false,ceiling:false},
    {label:"Full room drywall",patchType:"full",sqft:800,textureMatch:true,waterDamage:false,ceiling:false},
    {label:"Water damage restoration",patchType:"full",sqft:200,textureMatch:true,waterDamage:true,ceiling:false},
    {label:"Textured ceiling repair",patchType:"medium",sqft:100,textureMatch:true,waterDamage:false,ceiling:true},
    {label:"Basement finishing",patchType:"full",sqft:1000,textureMatch:true,waterDamage:false,ceiling:true}]},
  {name:"Flooring Installation",icon:"🏠",scenarios:[
    {label:"Living room hardwood",sqft:400,material:"hardwood",stairs:false,underlayment:true,furnitureMoving:false},
    {label:"Kitchen tile",sqft:250,material:"tile",stairs:false,underlayment:true,furnitureMoving:false},
    {label:"Basement laminate",sqft:650,material:"laminate",stairs:false,underlayment:true,furnitureMoving:true},
    {label:"Stairs and landing",sqft:0,material:"hardwood",stairs:true,underlayment:false,furnitureMoving:false},
    {label:"Full main level vinyl",sqft:1200,material:"vinyl",stairs:true,underlayment:true,furnitureMoving:true}]},
  {name:"Garage Door Service",icon:"🚗",scenarios:[
    {label:"Spring replacement",doorSize:"single",springIssue:true,offTrack:false,newOpener:false,insulated:false},
    {label:"Full door replacement",doorSize:"double",springIssue:false,offTrack:false,newOpener:false,insulated:true},
    {label:"Opener installation",doorSize:"single",springIssue:false,offTrack:false,newOpener:true,insulated:false},
    {label:"Insulated garage door",doorSize:"double",springIssue:false,offTrack:false,newOpener:true,insulated:true},
    {label:"Cable and track repair",doorSize:"single",springIssue:false,offTrack:true,newOpener:false,insulated:false}]},
  {name:"Solar Panel Installation",icon:"☀️",scenarios:[
    {label:"10-panel roof mount",panels:10,roofType:"asphalt",battery:false,mount:"roof",permit:true},
    {label:"20-panel full system",panels:20,roofType:"asphalt",battery:false,mount:"roof",permit:true},
    {label:"Ground mount system",panels:15,roofType:"asphalt",battery:false,mount:"ground",permit:true},
    {label:"Solar with battery backup",panels:15,roofType:"asphalt",battery:true,mount:"roof",permit:true},
    {label:"Solar roof tiles",panels:0,roofType:"tile",battery:false,mount:"roof",permit:true}]},
  {name:"Deck Building/Repair",icon:"🪵",scenarios:[
    {label:"Small ground-level deck",sqft:200,material:"treated",height:"ground",stairs:0,railings:true,stain:false},
    {label:"Two-story deck",sqft:300,material:"treated",height:"second",stairs:1,railings:true,stain:false},
    {label:"Composite deck",sqft:350,material:"composite",height:"ground",stairs:2,railings:true,stain:false},
    {label:"Deck repair and stain",sqft:250,material:"treated",height:"ground",stairs:0,railings:false,stain:true},
    {label:"Covered patio",sqft:400,material:"treated",height:"ground",stairs:0,railings:false,stain:false}]},
  {name:"Pool Service/Repair",icon:"🏊",scenarios:[
    {label:"Weekly chemical service",poolType:"in-ground",service:"weekly",equipment:false,opening:false,closing:false},
    {label:"Filter pump replacement",poolType:"in-ground",service:"none",equipment:"pump",opening:false,closing:false},
    {label:"Heater repair",poolType:"above-ground",service:"none",equipment:"heater",opening:false,closing:false},
    {label:"Pool opening",poolType:"in-ground",service:"none",equipment:false,opening:true,closing:false},
    {label:"Pool closing",poolType:"in-ground",service:"none",equipment:false,opening:false,closing:true}]},
  {name:"Appliance Repair",icon:"🔌",scenarios:[
    {label:"Refrigerator not cooling",appliance:"refrigerator",brand:"samsung",symptoms:"not cooling",underWarranty:false},
    {label:"Washing machine leak",appliance:"washer",brand:"lg",symptoms:"leaking",underWarranty:false},
    {label:"Oven not heating",appliance:"oven",brand:"ge",symptoms:"no heat",underWarranty:false},
    {label:"Dishwasher not draining",appliance:"dishwasher",brand:"kitchenaid",symptoms:"not draining",underWarranty:true},
    {label:"Dryer no heat",appliance:"dryer",brand:"whirlpool",symptoms:"no heat",underWarranty:false}]},
  {name:"Siding Installation/Repair",icon:"🏘️",scenarios:[
    {label:"Small patch repair",sqft:50,material:"vinyl",newInstall:false,trim:false,stories:1},
    {label:"Full house vinyl siding",sqft:1600,material:"vinyl",newInstall:true,trim:true,stories:2},
    {label:"Fiber cement siding",sqft:1500,material:"fiber-cement",newInstall:true,trim:true,stories:2},
    {label:"Trim and fascia replacement",sqft:0,material:"vinyl",newInstall:false,trim:true,stories:1},
    {label:"Partial reside",sqft:600,material:"vinyl",newInstall:true,trim:false,stories:1}]},
  {name:"Chimney Service",icon:"🔥",scenarios:[
    {label:"Annual cleaning",service:"cleaning",crownRepair:false,linerNeeded:false,damperReplace:false,stories:1},
    {label:"Crown repair",service:"crown",crownRepair:true,linerNeeded:false,damperReplace:false,stories:2},
    {label:"Liner installation",service:"liner",crownRepair:false,linerNeeded:true,damperReplace:false,stories:2},
    {label:"Damper replacement",service:"damper",crownRepair:false,linerNeeded:false,damperReplace:true,stories:1},
    {label:"Full chimney rebuild",service:"rebuild",crownRepair:true,linerNeeded:true,damperReplace:true,stories:2}]},
  {name:"Foundation Repair",icon:"🏗️",scenarios:[
    {label:"Crack injection",location:"interior",crackWidth:"1/8in",bowingWall:false,waterInBasement:false,soilType:"clay"},
    {label:"Wall straightening anchors",location:"interior",crackWidth:"1/2in",bowingWall:true,waterInBasement:false,soilType:"clay"},
    {label:"Drainage correction",location:"exterior",crackWidth:"0",bowingWall:false,waterInBasement:true,soilType:"silt"},
    {label:"Pier installation",location:"exterior",crackWidth:"1/4in",bowingWall:false,waterInBasement:false,soilType:"clay"},
    {label:"Full waterproofing",location:"exterior",crackWidth:"1/8in",bowingWall:false,waterInBasement:true,soilType:"loam"}]},
  {name:"Mold Remediation",icon:"🦠",scenarios:[
    {label:"Bathroom mold",sqft:50,location:"bathroom",visibleMold:true,waterSource:true,mustySmell:false},
    {label:"Basement mold",sqft:300,location:"basement",visibleMold:true,waterSource:true,mustySmell:true},
    {label:"Attic mold",sqft:200,location:"attic",visibleMold:false,waterSource:false,mustySmell:true},
    {label:"HVAC mold treatment",sqft:0,location:"hvac",visibleMold:false,waterSource:false,mustySmell:true},
    {label:"Whole-house treatment",sqft:2000,location:"whole-house",visibleMold:true,waterSource:true,mustySmell:true}]},
  {name:"Well Pump Service",icon:"💧",scenarios:[
    {label:"No water diagnosis",depth:200,wellIssue:"no-water",pumpType:"submersible",systemAge:15,lowPressure:false},
    {label:"Submersible pump replacement",depth:300,wellIssue:"pump-failure",pumpType:"submersible",systemAge:18,lowPressure:false},
    {label:"Pressure tank replacement",depth:150,wellIssue:"low-pressure",pumpType:"submersible",systemAge:10,lowPressure:true},
    {label:"Control box repair",depth:100,wellIssue:"no-power",pumpType:"jet",systemAge:8,lowPressure:false},
    {label:"Well chlorination",depth:250,wellIssue:"bacteria",pumpType:"submersible",systemAge:12,lowPressure:false}]},
  {name:"Septic System Service",icon:"🫧",scenarios:[
    {label:"Routine pumping",tankSize:1000,lastPumping:3,backup:false,fieldIssue:false,bedrooms:3},
    {label:"Full inspection",tankSize:1500,lastPumping:5,backup:false,fieldIssue:true,bedrooms:4},
    {label:"Drain field repair",tankSize:1000,lastPumping:2,backup:true,fieldIssue:true,bedrooms:3},
    {label:"Tank replacement",tankSize:1500,lastPumping:10,backup:false,fieldIssue:false,bedrooms:4},
    {label:"Emergency backup",tankSize:1000,lastPumping:4,backup:true,fieldIssue:false,bedrooms:3}]},
  {name:"Generator Installation",icon:"⚡",scenarios:[
    {label:"10kW standby generator",kw:10,wholeHouse:false,fuel:"nat-gas",transferSwitch:true,permit:true},
    {label:"22kW whole house",kw:22,wholeHouse:true,fuel:"nat-gas",transferSwitch:true,permit:true},
    {label:"Portable inlet install",kw:0,wholeHouse:false,fuel:"propane",transferSwitch:false,permit:false},
    {label:"Transfer switch only",kw:0,wholeHouse:false,fuel:"none",transferSwitch:true,permit:true},
    {label:"Generator maintenance",kw:10,wholeHouse:false,fuel:"nat-gas",transferSwitch:true,permit:false}]},
  {name:"Bathroom Remodeling",icon:"🛁",scenarios:[
    {label:"Vanity and lighting update",type:"vanity",tearOut:false,fixtures:true,tile:false,plumbingMove:false,accessible:false},
    {label:"Tub to shower conversion",type:"tub-shower",tearOut:true,fixtures:true,tile:true,plumbingMove:true,accessible:false},
    {label:"Complete master bath",type:"master",tearOut:true,fixtures:true,tile:true,plumbingMove:true,accessible:false},
    {label:"Half bath powder room",type:"half-bath",tearOut:true,fixtures:true,tile:false,plumbingMove:false,accessible:false},
    {label:"Accessible shower install",type:"accessible",tearOut:true,fixtures:true,tile:true,plumbingMove:true,accessible:true}]},
  {name:"Insulation Installation",icon:"🌡️",scenarios:[
    {label:"Attic blow-in",location:"attic",type:"blown-in",sqft:1000,rValue:49,airSealing:true,vaporBarrier:false},
    {label:"Wall injection",location:"walls",type:"injection",sqft:800,rValue:15,airSealing:false,vaporBarrier:false},
    {label:"Crawlspace encapsulation",location:"crawlspace",type:"encapsulation",sqft:500,rValue:30,airSealing:true,vaporBarrier:true},
    {label:"Spray foam attic",location:"attic",type:"spray-foam",sqft:800,rValue:38,airSealing:true,vaporBarrier:false},
    {label:"Garage insulation",location:"garage",type:"batt",sqft:600,rValue:13,airSealing:false,vaporBarrier:false}]}];

function fmtDetail(svc,s){
  switch(svc.name){
    case"Tree removal":{let p=[];p.push(s.trees+" tree"+(s.trees>1?"s":"")+" x "+s.height+"ft");if(s.nearHouse)p.push("crane needed");if(s.stump)p.push("stump grind");if(s.emergency)p.push("emergency");return p.join(" | ");}
    case"Roof inspection/replacement":{if(s.material==="patch")return"Leak diagnostic & patch repair";return s.sqft+"sqft "+s.pitch+" "+s.layers+"layer(s) "+s.material;}
    case"Emergency plumbing":{let d=s.replace?"Replace ":"Repair ";d+=s.pipeType+" "+s.accessibility+" access";if(s.emergency)d+=" emergency";return d;}
    case"Electrical panel upgrade":{if(s.amperage===0)return s.emergency?"Emergency breaker":"Fixture install";return s.amperage+"A panel"+(s.outdoor?" outdoor":"")+(s.permit?" +permit":"");}
    case"Landscape design":{let f=[];if(s.sqft>0)f.push(s.sqft+"sqft");if(s.patio)f.push("patio");if(s.plantings)f.push("plants");if(s.hardscape)f.push("hardscape");if(s.irrigation)f.push("irrigation");return f.join(" | ");}
    case"HVAC repair":{if(!s.repair)return s.tonnage+" ton "+s.system+" replacement";if(s.system==="duct")return"Ductwork cleaning & seal";if(s.system==="furnace")return"Furnace blower motor";return"AC capacitor "+s.tonnage+" ton";}
    case"Gutter cleaning":return s.linearFt+"ft "+s.stories+" story "+(s.debris==="heavy"?"heavy debris":"leaves");
    case"Pest control":return s.sqft+"sqft "+s.treatment+" severity:"+s.severity;
    case"Concrete driveway":return s.sqft+"sqft"+(s.demolition?" +demo":"")+(s.reinforced?" rebar":"")+" "+s.finish+" finish";
    case"Fence installation":return s.linearFt+"ft "+s.material+(s.gates?" "+s.gates+" gates":"")+" "+s.terrain;
    case"Window replacement":return s.count+" windows "+s.pane+" pane"+(s.story>1?" "+s.story+" story":"");
    case"Carpet cleaning":return s.rooms+" rooms "+s.sqft+"sqft"+(s.stains?" +stains":"")+(s.stairs?" +stairs":"");
    case"Pressure washing":return s.sqft+"sqft "+s.surface+(s.level==="heavy"?" heavy":"");
    case"Interior Painting":return s.rooms+" rooms "+(s.wallSqft>0?s.wallSqft+"sqft":"")+(s.trim?" +trim":"")+" "+s.grade+(s.colorChange?" color-change":"");
    case"Drywall Repair/Installation":return s.patchType+" "+(s.ceiling?"ceiling":"wall")+(s.textureMatch?" textured":"")+(s.waterDamage?" water-damage":"")+" "+s.sqft+"sqft";
    case"Flooring Installation":return s.sqft+"sqft "+(s.material)+(s.stairs?" +stairs":"")+(s.underlayment?" underlayment":"")+(s.furnitureMoving?" move-furniture":"");
    case"Garage Door Service":return s.doorSize+" door"+(s.springIssue?" spring-repair":s.offTrack?" track-repair":s.newOpener?" +opener":"")+(s.insulated?" insulated":"");
    case"Solar Panel Installation":return s.panels>0?s.panels+" panels":"tiles"+(s.battery?" +battery":"")+" "+s.mount+(s.permit?" +permit":"");
    case"Deck Building/Repair":return s.sqft+"sqft "+s.material+" "+(s.height==="second"?"2-story":"ground")+(s.railings?" railings":"")+(s.stairs>0?" "+s.stairs+" stairs":"")+(s.stain?" +stain":"");
    case"Pool Service/Repair":return s.poolType+" "+(s.service==="weekly"?"weekly service":s.equipment?s.equipment+" repair":s.opening?"opening":s.closing?"closing":"");
    case"Appliance Repair":return s.appliance+" "+s.brand+" "+s.symptoms+(s.underWarranty?" (warranty)":"");
    case"Siding Installation/Repair":return s.sqft+"sqft "+(s.material)+(s.newInstall?" new":" repair")+(s.trim?" +trim":"")+" "+s.stories+" story";
    case"Chimney Service":return s.service+(s.stories>1?" 2-story":"")+(s.crownRepair?" crown":s.linerNeeded?" liner":s.damperReplace?" damper":"");
    case"Foundation Repair":return s.location+" "+(s.bowingWall?"wall-anchors":s.crackWidth!=="0"?s.crackWidth+" crack":"drainage")+" "+s.soilType+" soil";
    case"Mold Remediation":return s.location+(s.sqft>0?" "+s.sqft+"sqft":"")+(s.waterSource?" +water-source":"")+(s.visibleMold?" visible":"");
    case"Well Pump Service":return s.depth+"ft "+s.pumpType+" "+(s.wellIssue==="no-water"?"diagnosis":s.wellIssue==="pump-failure"?"pump-replace":s.wellIssue==="low-pressure"?"tank-replace":s.wellIssue==="no-power"?"control-repair":"chlorination")+" "+s.systemAge+"yr";
    case"Septic System Service":return s.tankSize+"gal "+(s.backup?"backup":"")+(s.fieldIssue?" drain-field":" pumping")+" "+s.bedrooms+"br";
    case"Generator Installation":return s.kw>0?s.kw+"kW":"inlet"+(s.wholeHouse?" whole-house":"")+" "+s.fuel+(s.permit?" +permit":"");
    case"Bathroom Remodeling":return s.type+(s.tearOut?" tear-out":"")+(s.tile?" tile":"")+(s.accessible?" accessible":"");
    case"Insulation Installation":return s.location+" "+s.type+" "+s.sqft+"sqft r-"+s.rValue+(s.airSealing?" +sealing":"");
    default:return"";
  }
}
const fNames=["James","Maria","Robert","Sarah","Michael","Jennifer","David","Linda","John","Patricia","William","Barbara","Thomas","Elizabeth","Christopher","Susan","Daniel","Jessica","Matthew","Donna"];
const lNames=["Smith","Garcia","Johnson","Brown","Williams","Miller","Jones","Davis","Rodriguez","Martinez","Hernandez","Lopez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee"];
const sNames=["Oak","Maple","Cedar","Pine","Elm","Birch","Walnut","Cherry","Spruce","Willow","Ash","Magnolia","Hickory","Sycamore","Poplar","Chestnut","Hemlock","Dogwood","Locust","Juniper"];
const sTypes=["St","Ave","Dr","Ln","Rd","Ct","Way","Pl","Blvd","Cir"];
const aCodes=["860","203","401","413","845","914","475","959","518","607"];
function genTranscript(svc,s,name,phone,num,sn,st){
      const addr=num+" "+sn+" "+st;
      const first=name.split(" ")[0];
      function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
      function trees(t){return t===1?"tree":"trees";}
      function aAn(w){return /^[aeiou]/i.test(w)?"an":"a";}
      switch(svc.name){
        case"Tree removal":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: Hi, I need some "+(s.emergency?"emergency ":"")+"tree removal done.");
          lines.push("AI: "+(s.emergency?"I understand it's urgent. ":"")+"How many trees need to be removed?");
          lines.push("Customer: "+s.trees+".");
          if(s.trees<=2){}else{
            lines.push("AI: And how many of them?");
            lines.push("Customer: I said "+s.trees+", I need them all removed.");
          }
          lines.push("AI: About how tall are they — roughly?");
          lines.push("Customer: Around "+s.height+" feet each.");
          lines.push("AI: Are any of them near structures like your house, garage, or power lines?");
          lines.push("Customer: "+(s.nearHouse?"Yeah, they're right next to the house.":"No, they're out in the open."));
          if(s.stump){
            lines.push("AI: Do you need stump grinding done as well?");
            lines.push("Customer: Yes, please grind the stumps.");
          }
          lines.push("AI: Got it. Let me get your info. What's your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          let det=s.trees+" "+trees(s.trees)+" at "+s.height+"ft";
          if(s.nearHouse)det+=" near structures";
          if(s.stump)det+=", stump grinding";
          if(s.emergency)det+=" (emergency)";
          lines.push("AI: Thanks "+first+". I have "+det+". We'll have an estimator reach out to schedule a time. Thank you!");
          return lines.join("\n");
        }
        case"Roof inspection/replacement":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.material==="patch"){
            lines.push("Customer: I've got a roof leak I need repaired.");
            lines.push("AI: I'm sorry to hear that. How big is the area affected?");
            lines.push("Customer: It's about a "+s.sqft+" square foot patch around the chimney.");
            lines.push("AI: Got it. Do you know what type of roofing material you have?");
            lines.push("Customer: It's asphalt shingles.");
            lines.push("AI: And how accessible is the roof — is it a steep pitch?");
            lines.push("Customer: No, it's a low slope roof, easy to walk on.");
            lines.push("AI: Good to know. Let me get your information. What's your name?");
            lines.push("Customer: "+name+".");
            lines.push("AI: And your address?");
            lines.push("Customer: "+addr+".");
            lines.push("AI: Thanks "+first+". We'll send an inspector to assess the leak and get you sorted. Thank you!");
          }else{
            lines.push("Customer: I need "+(s.material==="metal"?"a metal":"a new")+" roof installed.");
            lines.push("AI: Great! What's the approximate square footage of the roof?");
            lines.push("Customer: About "+s.sqft+" square feet.");
            lines.push("AI: And what material are you looking to use?");
            lines.push("Customer: We want "+(s.material==="metal"?"metal":s.material==="architectural"?"architectural shingles":"asphalt shingles")+".");
            lines.push("AI: How many layers of existing roofing are there?");
            lines.push("Customer: There "+(s.layers>1?"are "+s.layers+" layers":"is one layer")+" currently on there.");
            lines.push("AI: What's the roof pitch like — low, moderate, or steep?");
            lines.push("Customer: It's "+aAn(s.pitch)+" "+s.pitch+" pitch.");
            lines.push("AI: Perfect. Let me grab your contact info. Your name?");
            lines.push("Customer: "+name+".");
            lines.push("AI: And your address?");
            lines.push("Customer: "+addr+".");
            lines.push("AI: Thanks "+first+". I have a "+s.sqft+"sqft "+s.material+" roof, "+s.pitch+" pitch, "+s.layers+" layer(s). An estimator will be in touch. Thank you!");
          }
          return lines.join("\n");
        }
        case"Emergency plumbing":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.emergency){
            lines.push("Customer: I have "+(s.replace?"a water emergency — my tank burst":"an emergency — "+(s.pipeType==="cast-iron"?"my sewer line is backed up":"a pipe burst"))+"!");
            lines.push("AI: I understand this is urgent! I'll get help out quickly. What type of pipe is it?");
          }else{
            lines.push("Customer: I need "+(s.replace?"a new water heater installed":"some plumbing work done — "+(s.pipeType==="pvc"?"a faucet repair":"a pipe repair"))+".");
            lines.push("AI: Sure, I can help with that. What type of pipes do you have?");
          }
          lines.push("Customer: They're "+s.pipeType+" pipes.");
          lines.push("AI: And how accessible is the area — easy, moderate, or hard to reach?");
          lines.push("Customer: I'd say accessibility is "+s.accessibility+".");
          lines.push("AI: "+(s.replace?"So you need this replaced, not just repaired?":"And this is a repair, not a full replacement?"));
          lines.push("Customer: "+(s.replace?"Yes, it needs to be replaced.":"Correct, just a repair."));
          if(s.emergency)lines.push("AI: Emergency call, understood. We'll prioritize this.");
          lines.push("AI: Let me get your details. What's your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We have "+(s.replace?"a replacement":"a repair")+" on "+s.pipeType+", accessibility is "+s.accessibility+(s.emergency?". We'll rush someone out ASAP!":".")+" Thank you!");
          return lines.join("\n");
        }
        case"Electrical panel upgrade":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.amperage===0){
            lines.push("Customer: I need "+(s.emergency?"an emergency breaker fix — something tripped and won't reset":"some light fixtures installed")+".");
            lines.push("AI: Got it. "+(s.emergency?"This sounds urgent. We can get a licensed electrician out right away.":"How many fixtures are you looking to install?"));
            if(!s.emergency)lines.push("Customer: About 6 fixtures.");
          }else{
            lines.push("Customer: I need "+(s.outdoor?"an outdoor":"an")+" electrical panel upgrade to "+s.amperage+" amps.");
            lines.push("AI: "+(s.outdoor?"An outdoor panel — good to know. ":"")+(s.permit?"Are permits already pulled for this?":"Is this just a straight panel swap?"));
            lines.push("Customer: "+(s.permit?"We'll need a permit, yes.":"No permits needed."));
            lines.push("AI: "+(s.outdoor?"And the panel is mounted outside the house, correct?":"And is the panel indoors?"));
            lines.push("Customer: "+(s.outdoor?"Yes, it's outside.":"Yes, it's inside."));
          }
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          if(s.amperage===0){
            lines.push("AI: Thanks "+first+". "+(s.emergency?"We'll get an electrician to you ASAP.":"We'll have someone reach out to schedule the install.")+" Thank you!");
          }else{
            lines.push("AI: Thanks "+first+". We have a "+s.amperage+"A panel upgrade"+(s.outdoor?" outdoor":"")+(s.permit?" with permit":"")+". An electrician will reach out to schedule. Thank you!");
          }
          return lines.join("\n");
        }
        case"Landscape design":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I'm looking for landscape design for my yard.");
          lines.push("AI: Great! What's the approximate square footage of the area?");
          lines.push("Customer: It's about "+s.sqft+" square feet.");
          lines.push("AI: Are you looking to add a patio or walkway?");
          lines.push("Customer: "+(s.patio?"Yes, we want a patio installed.":"No, just focusing on the yard."));
          if(s.hardscape){
            lines.push("AI: Any hardscape features like retaining walls or stonework?");
            lines.push("Customer: Yes, we want "+(s.sqft===0?"a retaining wall and drainage":"some hardscape features")+".");
          }
          if(s.plantings){
            lines.push("AI: Do you need plantings — shrubs, flowers, trees?");
            lines.push("Customer: Yes, we'd like new plantings throughout.");
          }
          if(s.irrigation){
            lines.push("AI: And what about irrigation — do you need a sprinkler system?");
            lines.push("Customer: Yes, we need irrigation installed.");
          }
          lines.push("AI: Excellent! Let me get your information. Your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          let features=[];
          if(s.patio)features.push("patio");
          if(s.plantings)features.push("plantings");
          if(s.hardscape)features.push("hardscape");
          if(s.irrigation)features.push("irrigation");
          lines.push("AI: Thanks "+first+". I have "+s.sqft+" sqft of landscaping with "+features.join(", ")+". A designer will reach out to discuss. Thank you!");
          return lines.join("\n");
        }
        case"HVAC repair":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(!s.repair){
            lines.push("Customer: I need "+(s.system==="heat-pump"?"a heat pump":"a new "+s.system+" system")+" replacement.");
            lines.push("AI: I see. What tonnage is your current system?");
            lines.push("Customer: It's a "+s.tonnage+"-ton system.");
            lines.push("AI: And do you know what type of refrigerant it uses?");
            lines.push("Customer: It uses R-410A.");
            lines.push("AI: "+(s.system==="heat-pump"?"So a heat pump replacement at "+s.tonnage+" tons.":"A "+s.tonnage+"-ton AC replacement."));
          }else if(s.system==="duct"){
            lines.push("Customer: I need my ductwork cleaned and sealed.");
            lines.push("AI: Sounds good. About how big is your home?");
            lines.push("Customer: Around 2,000 square feet.");
            lines.push("AI: Do you know when the ducts were last cleaned?");
            lines.push("Customer: It's been several years, honestly.");
          }else if(s.system==="furnace"){
            lines.push("Customer: My furnace blower motor stopped working.");
            lines.push("AI: That's no good this time of year. Has the furnace been making unusual noises?");
            lines.push("Customer: Yes, it was rattling before it quit entirely.");
            lines.push("AI: Got it. "+(s.tonnage>0?"What tonnage is the unit?":"We handle all standard furnace models."));
            if(s.tonnage>0)lines.push("Customer: It's a "+s.tonnage+"-ton unit.");
          }else{
            lines.push("Customer: My AC isn't cooling — I think it might be the capacitor.");
            lines.push("AI: I see. What tonnage is your AC unit?");
            lines.push("Customer: It's a "+s.tonnage+"-ton unit.");
            lines.push("AI: "+(s.refrigerant!=="none"?"Do you know the refrigerant type?":"Good to know."));
            if(s.refrigerant!=="none")lines.push("Customer: It uses "+s.refrigerant.toUpperCase()+".");
          }
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll have an HVAC technician reach out to schedule. Thank you!");
          return lines.join("\n");
        }
        case"Gutter cleaning":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need my gutters cleaned out.");
          lines.push("AI: How many linear feet of gutter do you have?");
          lines.push("Customer: About "+s.linearFt+" feet total.");
          lines.push("AI: And is your home single story or two story?");
          lines.push("Customer: It's "+(s.stories>1?"two stories":"a single story")+".");
          lines.push("AI: What kind of debris are we dealing with — leaves or heavier buildup?");
          lines.push("Customer: It's "+(s.debris==="heavy"?"pretty heavy buildup — there's dirt and debris mixed in":"mostly leaves")+".");
          lines.push("AI: Would you like a quote for gutter guards to prevent future buildup?");
          lines.push("Customer: "+(s.debris==="heavy"?"Yeah, I'm interested in guards too.":"Not right now, just the cleaning."));
          lines.push("AI: Got it. Let me get your info. Your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We have "+s.linearFt+"ft of gutters, "+(s.stories>1?"two story":"single story")+". We'll have a crew reach out to schedule. Thank you!");
          return lines.join("\n");
        }
        case"Pest control":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need pest control service.");
          lines.push("AI: Sure! What kind of pest are you dealing with?");
          lines.push("Customer: We have "+(s.treatment==="termite"?"termites":s.treatment==="rodent"?"rodents":"an ant infestation")+".");
          lines.push("AI: How severe would you say the problem is — low, moderate, or severe?");
          lines.push("Customer: I'd say it's "+s.severity+".");
          lines.push("AI: And what's the approximate square footage of your home?");
          lines.push("Customer: About "+s.sqft+" square feet.");
          lines.push("AI: "+(s.treatment==="termite"?"Termites need immediate attention. We'll schedule an inspection right away.":s.treatment==="rodent"?"We can set up exclusion and trapping.":"We can treat for ants with a thorough perimeter spray."));
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We have a "+(s.sqft)+"sqft home with "+s.treatment+" treatment needed, severity "+s.severity+". A pest control specialist will reach out. Thank you!");
          return lines.join("\n");
        }
        case"Concrete driveway":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.demolition){
            lines.push("Customer: I need my old driveway removed and a new one poured.");
            lines.push("AI: Sure! What's the square footage of the driveway?");
            lines.push("Customer: About "+s.sqft+" square feet.");
            lines.push("AI: So demolition of the existing slab, and pour new. Are you looking at reinforced concrete with rebar?");
          }else{
            lines.push("Customer: I want to pour a new concrete "+(s.sqft<500?"walkway":"driveway")+".");
            lines.push("AI: Great! What's the total square footage?");
            lines.push("Customer: About "+s.sqft+" square feet.");
            lines.push("AI: "+(s.sqft<500?"A nice walkway. ":"A good-sized driveway. ")+"Do you want it reinforced with rebar or wire mesh?");
          }
          lines.push("Customer: "+(s.reinforced?"Yes, I want it reinforced.":"No, standard concrete is fine."));
          lines.push("AI: And what type of finish are you looking for — broom, smooth, or stamped?");
          lines.push("Customer: We'd like "+(s.finish==="stamp"?"a stamped decorative":"a "+(s.finish==="smooth"?"smooth":"broom"))+" finish.");
          lines.push("AI: "+(s.demolition?"So that's a demo and repour, ":"New pour, ")+s.sqft+" sqft, "+(s.reinforced?"reinforced, ":"")+s.finish+" finish. Sounds good!");
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". "+(s.demolition?"We'll schedule a demo and pour.":"We'll have a concrete crew reach out for the pour.")+" Thank you!");
          return lines.join("\n");
        }
        case"Fence installation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need a fence installed.");
          lines.push("AI: How many linear feet are you looking at?");
          lines.push("Customer: About "+s.linearFt+" feet.");
          lines.push("AI: What material are you considering — wood, vinyl, chain-link, or split-rail?");
          lines.push("Customer: We want "+s.material+".");
          lines.push("AI: How many gates do you need?");
          lines.push("Customer: "+(s.gates>0?+s.gates+" gates.":"No gates needed."));
          lines.push("AI: What's the terrain like where the fence will go — flat, slight slope, or moderate slope?");
          lines.push("Customer: It's "+s.terrain.replace("-"," ")+".");
          lines.push("AI: "+(s.terrain.includes("slope")?"We handle sloped terrain all the time.":"Flat terrain is straightforward.")+" Let me get your info. Your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". "+s.linearFt+"ft of "+s.material+(s.gates?" with "+s.gates+" gates":"")+" on "+s.terrain.replace("-"," ")+". A fencing contractor will reach out. Thank you!");
          return lines.join("\n");
        }
        case"Window replacement":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I'm looking to replace some windows.");
          lines.push("AI: How many windows are you looking to replace?");
          lines.push("Customer: "+s.count+" window"+(s.count>1?"s":"")+".");
          lines.push("AI: Are you looking at double-pane or triple-pane windows?");
          lines.push("Customer: We want "+s.pane+"-pane windows.");
          lines.push("AI: What floor are the windows on?");
          lines.push("Customer: They're on the "+(s.story>1?"second":"first")+" floor.");
          lines.push("AI: "+(s.story>1?"Second floor installs cost a bit more for labor.":"First floor is straightforward.")+" ");
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". I have "+s.count+" "+s.pane+"-pane windows on the "+(s.story>1?"second":"first")+" floor. An installer will reach out to schedule. Thank you!");
          return lines.join("\n");
        }
        case"Carpet cleaning":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need my carpets cleaned.");
          lines.push("AI: How many rooms need cleaning?");
          lines.push("Customer: "+s.rooms+" room"+(s.rooms>1?"s":"")+".");
          lines.push("AI: What's the total square footage?");
          lines.push("Customer: About "+s.sqft+" square feet.");
          lines.push("AI: Do you have any stubborn stains that need special treatment?");
          lines.push("Customer: "+(s.stains?"Yes, there are some tough stains we need removed.":"No, just a general clean."));
          if(s.stairs){
            lines.push("AI: Any stairs that need cleaning too?");
            lines.push("Customer: Yes, there are stairs as well.");
          }
          lines.push("AI: "+(s.stains?"We have great stain removal treatments.":"Great, a standard deep clean.")+" Let me get your info. Your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We have "+s.rooms+" rooms, "+s.sqft+" sqft"+(s.stains?", stain treatment":"")+(s.stairs?", stairs":"")+". A cleaning crew will reach out to schedule. Thank you!");
          return lines.join("\n");
        }
        case"Pressure washing":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need pressure washing done.");
          lines.push("AI: What type of surface are you having cleaned — driveway, house exterior, deck, or a combination?");
          lines.push("Customer: I need the "+(s.surface==="driveway"?"driveway":s.surface==="house"?"house exterior":s.surface==="both"?"driveway and house":s.surface==="deck"?"deck and patio":"property")+" cleaned.");
          lines.push("AI: About how many square feet?");
          lines.push("Customer: Around "+s.sqft+" square feet.");
          lines.push("AI: And how dirty is it — normal buildup or heavy grime?");
          lines.push("Customer: It's "+(s.level==="heavy"?"pretty heavy — there's years of buildup.":"normal seasonal dirt."));
          lines.push("AI: "+(s.level==="heavy"?"Heavy cleaning might need some extra passes and a degreaser.":"Normal cleaning will get it looking great.")+" ");
          if(s.surface==="deck")lines.push(lines.pop()+"We use a soft wash for decks to protect the wood.");
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We have "+s.sqft+" sqft of "+(s.surface==="both"?"driveway and house":s.surface)+" cleaning"+(s.level==="heavy"?" (heavy duty)":"")+". A crew will reach out to schedule. Thank you!");
          return lines.join("\n");
        }

        case"Interior Painting":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need some interior painting done.");
          lines.push("AI: Great! How many rooms are we painting?");
          lines.push("Customer: "+(s.rooms>0?s.rooms+" room"+(s.rooms>1?"s":""):"Just the exterior trim")+".");
          if(s.wallSqft>0){lines.push("AI: What's the total wall square footage?");lines.push("Customer: About "+s.wallSqft+" square feet.");}
          if(s.ceilingHeight>8){lines.push("AI: And what's the ceiling height — standard 8ft or higher?");lines.push("Customer: It's "+s.ceilingHeight+" feet, we have vaulted ceilings.");}
          lines.push("AI: Are you looking for economy or premium grade paint?");
          lines.push("Customer: We want "+(s.grade==="premium"?"premium — it lasts longer.":"economy grade."));
          if(s.trim){lines.push("AI: Will there be any trim work — baseboards, crown molding, or cabinets?");lines.push("Customer: Yes, we need the trim done too.");}
          if(s.colorChange){lines.push("AI: Is this a color change or same color touch-up?");lines.push("Customer: It's a color change, so we'll need coverage.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        case"Drywall Repair/Installation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need "+(s.patchType==="small"?"a small patch repair":s.waterDamage?"water damage drywall repair":"drywall installed")+".");
          lines.push("AI: "+(s.patchType==="small"?"How big is the hole? About how many square feet?":"What's the total square footage?"));
          lines.push("Customer: "+(s.patchType==="small"?"It's a small hole, about "+s.sqft+" sqft.":"About "+s.sqft+" square feet."));
          if(s.waterDamage){lines.push("AI: Was there water damage involved?");lines.push("Customer: Yes, we had a leak that damaged the drywall.");}
          if(s.textureMatch){lines.push("AI: Do you need the texture matched to the existing wall?");lines.push("Customer: Yes, we want it to match the rest of the wall.");}
          if(s.ceiling){lines.push("AI: Is this a ceiling or wall?");lines.push("Customer: It's the ceiling.");lines.push("AI: Ceiling work needs some extra care.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". "+(s.patchType==="small"?"Small patch":s.sqft+"sqft "+(s.ceiling?"ceiling":"wall"))+(s.textureMatch?" textured":"")+(s.waterDamage?" water-damage":"")+". We'll have a drywall pro reach out. Thank you!");
          return lines.join("\n");
        }
        case"Flooring Installation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need new flooring installed.");
          lines.push("AI: What type of flooring are you looking at — hardwood, laminate, tile, or vinyl?");
          lines.push("Customer: We want "+s.material+".");
          lines.push("AI: What's the total square footage?");
          lines.push("Customer: About "+s.sqft+" square feet.");
          if(s.furnitureMoving){lines.push("AI: Do you need help moving furniture out of the way?");lines.push("Customer: Yes, we'll need furniture moved.");}
          if(s.stairs){lines.push("AI: Any stairs or landing to do as well?");lines.push("Customer: Yes, we have stairs that need flooring too.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        case"Garage Door Service":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.springIssue)lines.push("Customer: My garage door spring broke — the door won't open.");
          else if(s.offTrack)lines.push("Customer: My garage door came off the track.");
          else if(s.newOpener)lines.push("Customer: I need a new garage door opener installed.");
          else lines.push("Customer: I need a new garage door installed.");
          lines.push("AI: "+(s.springIssue||s.offTrack?"That sounds urgent. ":"")+"Is it a single or double car door?");
          lines.push("Customer: It's a "+(s.doorSize==="double"?"double":"single")+" car door.");
          if(s.insulated){lines.push("AI: Are you looking for an insulated door?");lines.push("Customer: Yes, I want it insulated.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          if(s.springIssue)lines.push("AI: Thanks "+first+". We have a spring replacement for a "+s.doorSize+" door. We'll get someone out ASAP.");
          else if(s.offTrack)lines.push("AI: Thanks "+first+". We'll send a tech to fix the track on your "+s.doorSize+" door.");
          return lines.join("\n");
        }
        case"Solar Panel Installation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.roofType==="tile"){lines.push("Customer: I'm interested in solar roof tiles.");lines.push("AI: Great choice! Solar tiles integrate right into the roof.");}
          else{lines.push("Customer: I want to install solar panels on my property.");
          lines.push("AI: How many panels are you looking at?");
          lines.push("Customer: "+(s.panels>0?s.panels+" panels.":"We're looking at a full system."));
          lines.push("AI: What type of roof do you have — asphalt, metal, or tile?");
          lines.push("Customer: It's "+(s.roofType==="asphalt"?"asphalt shingles":"a "+s.roofType+" roof")+".");
          lines.push("AI: "+(s.mount==="ground"?"Would this be a ground mount installation?":"Are you looking at a roof mount or ground mount?"));
          lines.push("Customer: "+(s.mount==="ground"?"Ground mount — we have the land for it.":"Roof mount is fine."));}
          if(s.battery){lines.push("AI: Do you need battery backup for energy storage?");lines.push("Customer: Yes, we want a battery backup system.");}
          if(s.permit){lines.push("AI: Do you need help with permits?");lines.push("Customer: Yes, we need the permits handled.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        case"Deck Building/Repair":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.stain)lines.push("Customer: I need my deck repaired and stained.");
          else lines.push("Customer: I want to build "+(s.sqft<300?"a small deck":"a new deck")+".");
          if(!s.stain){lines.push("AI: What's the approximate square footage?");lines.push("Customer: About "+s.sqft+" square feet.");}
          lines.push("AI: What material are you considering — treated lumber, cedar, or composite?");
          lines.push("Customer: We want "+(s.material==="treated"?"treated lumber":s.material==="composite"?"composite — low maintenance":s.material)+".");
          lines.push("AI: Will this be ground level or a second story deck?");
          lines.push("Customer: It's "+(s.height==="second"?"a second story deck":"ground level")+".");
          if(s.railings){lines.push("AI: Do you need railings?");lines.push("Customer: Yes, we need railings.");}
          if(s.stairs>0){lines.push("AI: How many sets of stairs?");lines.push("Customer: "+s.stairs+" set"+(s.stairs>1?"s":"")+".");}
          if(s.stain){lines.push("AI: And you need staining done as well?");lines.push("Customer: Yes, power wash and stain.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        case"Pool Service/Repair":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.service==="weekly"){lines.push("Customer: I need weekly pool chemical service.");lines.push("AI: Great! Is your pool in-ground or above-ground?");lines.push("Customer: It's "+s.poolType+".");}
          else if(s.opening){lines.push("Customer: I need my pool opened for the season.");lines.push("AI: Sure! Is it an in-ground or above-ground pool?");lines.push("Customer: It's "+s.poolType+".");}
          else if(s.closing){lines.push("Customer: I need my pool closed for winter.");lines.push("AI: Got it. In-ground or above-ground?");lines.push("Customer: It's "+s.poolType+".");}
          else if(s.equipment==="pump"){lines.push("Customer: My pool filter pump isn't working.");lines.push("AI: Sorry to hear that. Is it an in-ground or above-ground pool?");lines.push("Customer: It's "+s.poolType+".");lines.push("AI: We can replace the pump. Do you know the model?");lines.push("Customer: I'm not sure offhand.");}
          else if(s.equipment==="heater"){lines.push("Customer: My pool heater stopped heating.");lines.push("AI: We can help with that. Is your pool in-ground or above-ground?");lines.push("Customer: It's "+s.poolType+".");lines.push("AI: We'll get a pool tech to diagnose the heater.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". "+(s.service==="weekly"?"We'll set up weekly service.":s.opening?"We'll schedule the pool opening.":s.closing?"We'll schedule the pool closing.":s.equipment==="pump"?"We'll send a tech to replace the pump.":s.equipment==="heater"?"We'll send someone to check the heater.":"")+" Thank you!");
          return lines.join("\n");
        }
        case"Appliance Repair":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: My "+s.appliance+" is having issues.");
          lines.push("AI: What brand is it?");
          lines.push("Customer: It's a "+s.brand+".");
          lines.push("AI: What symptoms are you experiencing?");
          lines.push("Customer: It's "+s.symptoms+".");
          lines.push("AI: Is it still under warranty?");
          lines.push("Customer: "+(s.underWarranty?"Yes, it's still covered.":"No, it's out of warranty."));
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll send an appliance tech to look at your "+s.brand+" "+s.appliance+". Thank you!");
          return lines.join("\n");
        }
        case"Siding Installation/Repair":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.newInstall)lines.push("Customer: I need new siding installed on my home.");
          else if(s.trim)lines.push("Customer: I need my trim and fascia replaced.");
          else lines.push("Customer: I need a siding repair.");
          if(s.sqft>0){lines.push("AI: What's the total square footage?");lines.push("Customer: About "+s.sqft+" square feet.");}
          lines.push("AI: What material are you looking at — vinyl, fiber cement, or wood?");
          lines.push("Customer: We want "+(s.material==="fiber-cement"?"fiber cement":s.material)+".");
          if(s.trim&&s.sqft>0){lines.push("AI: Do you need trim and fascia work too?");lines.push("Customer: Yes, fresh trim and fascia.");}
          lines.push("AI: How many stories is the home?");
          lines.push("Customer: "+(s.stories>1?"Two stories.":"Single story."));
          lines.push("AI: "+(s.stories>1?"Two-story work takes a bit more time.":"Single story is straightforward.")+" Let me get your info. Your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        case"Chimney Service":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.service==="cleaning"){lines.push("Customer: I need my chimney cleaned.");lines.push("AI: Great! How many stories is your home?");lines.push("Customer: "+(s.stories>1?"Two stories.":"Single story."));}
          else if(s.service==="crown"){lines.push("Customer: The crown on my chimney needs repair.");lines.push("AI: We can fix that. How many stories?");lines.push("Customer: "+(s.stories>1?"Two stories.":"Single story."));}
          else if(s.service==="liner"){lines.push("Customer: I need a new chimney liner installed.");lines.push("AI: We handle liner installations. How many stories?");lines.push("Customer: "+(s.stories>1?"Two stories.":"Single story."));}
          else if(s.service==="damper"){lines.push("Customer: My chimney damper needs replacing.");lines.push("AI: We can replace the damper. How many stories?");lines.push("Customer: "+(s.stories>1?"Two stories.":"Single story."));}
          else if(s.service==="rebuild"){lines.push("Customer: My chimney needs a full rebuild.");lines.push("AI: Understood. How many stories?");lines.push("Customer: "+(s.stories>1?"Two stories.":"Single story."));lines.push("AI: A full rebuild takes some time but we'll get it done right.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        case"Foundation Repair":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.bowingWall){lines.push("Customer: My basement wall is bowing inward.");lines.push("AI: That sounds serious. We'll get a foundation specialist out. Is the crack more than 1/4 inch?");lines.push("Customer: Yes, it's about "+s.crackWidth+".");}
          else if(s.waterInBasement&&s.location==="exterior"){lines.push("Customer: I have water in my basement and need drainage fixed.");lines.push("AI: We can help with exterior drainage. What type of soil do you have?");lines.push("Customer: It's "+s.soilType+" soil.");}
          else if(s.location==="exterior"&&s.crackWidth!=="0"){lines.push("Customer: I need foundation piers installed.");lines.push("AI: How wide are the cracks in the foundation?");lines.push("Customer: About "+s.crackWidth+".");lines.push("AI: What type of soil do you have?");lines.push("Customer: It's "+s.soilType+" soil.");}
          else{lines.push("Customer: I have a crack in my foundation wall.");lines.push("AI: How wide is the crack?");lines.push("Customer: It's about "+s.crackWidth+".");lines.push("AI: "+(s.waterInBasement?"Does water come through when it rains?":"Is it on the interior or exterior?"));if(s.waterInBasement)lines.push("Customer: Yes, water seeps in.");else lines.push("Customer: "+(s.location==="interior"?"Interior.":"Exterior."));}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll have a foundation specialist contact you. Thank you!");
          return lines.join("\n");
        }
        case"Mold Remediation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.location==="hvac"){lines.push("Customer: I think there's mold in my HVAC system.");lines.push("AI: We can treat HVAC mold. Can you smell a musty odor when the system runs?");lines.push("Customer: "+(s.mustySmell?"Yes, it smells musty.":"Not really, but I can see visible mold."));}
          else{lines.push("Customer: I have mold in my "+(s.location==="whole-house"?"home":" "+s.location)+".");
          lines.push("AI: How many square feet are affected?");
          lines.push("Customer: "+(s.sqft>0?"About "+s.sqft+" sqft.":"I'm not sure of the exact size."));
          if(s.visibleMold){lines.push("AI: Can you see visible mold growth?");lines.push("Customer: Yes, it's visible.");}
          if(s.waterSource){lines.push("AI: Is there an active water source causing the mold?");lines.push("Customer: Yes, there's a moisture issue.");}
          if(s.mustySmell){lines.push("AI: Do you notice a musty smell?");lines.push("Customer: Yes, definitely.");}}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll have a mold remediation specialist reach out to assess the "+(s.location==="hvac"?"HVAC system":s.sqft>0?s.sqft+"sqft area":"property")+". Thank you!");
          return lines.join("\n");
        }
        case"Well Pump Service":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.wellIssue==="no-water"){lines.push("Customer: I have no water coming from my well.");lines.push("AI: That's urgent. How deep is your well?");lines.push("Customer: It's about "+s.depth+" feet deep.");lines.push("AI: Do you have a submersible or jet pump?");lines.push("Customer: It's "+s.pumpType+".");lines.push("AI: How old is the system?");lines.push("Customer: About "+s.systemAge+" years old.");}
          else if(s.wellIssue==="pump-failure"){lines.push("Customer: My well pump stopped working.");lines.push("AI: How deep is your well?");lines.push("Customer: It's about "+s.depth+" feet deep.");lines.push("AI: Submersible or jet pump?");lines.push("Customer: It's "+s.pumpType+".");lines.push("AI: How old is the system?");lines.push("Customer: About "+s.systemAge+" years old.");}
          else if(s.wellIssue==="low-pressure"){lines.push("Customer: My water pressure is low.");lines.push("AI: How deep is the well?");lines.push("Customer: About "+s.depth+" feet.");lines.push("AI: It could be the pressure tank. How old is the system?");lines.push("Customer: About "+s.systemAge+" years.");}
          else if(s.wellIssue==="no-power"){lines.push("Customer: The well pump has no power.");lines.push("AI: That could be a control box issue. What type of pump do you have?");lines.push("Customer: It's "+s.pumpType+".");lines.push("AI: How old is the system?");lines.push("Customer: About "+s.systemAge+" years.");}
          else if(s.wellIssue==="bacteria"){lines.push("Customer: My well water tested positive for bacteria.");lines.push("AI: We can do a well chlorination. How deep is the well?");lines.push("Customer: About "+s.depth+" feet.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll send a well service technician to address your "+(s.wellIssue==="no-water"?"no water":s.wellIssue==="pump-failure"?"pump failure":s.wellIssue==="low-pressure"?"low pressure":s.wellIssue==="no-power"?"electrical issue":"chlorination")+". Thank you!");
          return lines.join("\n");
        }
        case"Septic System Service":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.backup&&s.fieldIssue){lines.push("Customer: My septic is backing up and the drain field is failing.");lines.push("AI: That sounds like a serious issue. What size tank do you have?");lines.push("Customer: It's a "+s.tankSize+" gallon tank.");lines.push("AI: How many bedrooms in the home?");lines.push("Customer: "+s.bedrooms+" bedrooms.");lines.push("AI: When was it last pumped?");lines.push("Customer: About "+s.lastPumping+" years ago.");}
          else if(s.fieldIssue){lines.push("Customer: I think my drain field is failing.");lines.push("AI: We can inspect it. What size tank?");lines.push("Customer: "+s.tankSize+" gallons.");lines.push("AI: How many bedrooms?");lines.push("Customer: "+s.bedrooms+" bedrooms.");}
          else if(s.backup){lines.push("Customer: My septic system is backing up.");lines.push("AI: We'll get someone out. What size tank?");lines.push("Customer: "+s.tankSize+" gallons.");lines.push("AI: When was it last pumped?");lines.push("Customer: About "+s.lastPumping+" years ago.");}
          else{lines.push("Customer: I need my septic tank pumped.");lines.push("AI: What size tank do you have?");lines.push("Customer: It's a "+s.tankSize+" gallon tank.");lines.push("AI: How many bedrooms in the home?");lines.push("Customer: "+s.bedrooms+" bedrooms.");lines.push("AI: When was it last pumped?");lines.push("Customer: About "+s.lastPumping+" years ago.");}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll have a septic service contact you. Thank you!");
          return lines.join("\n");
        }
        case"Generator Installation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.kw===0&&!s.transferSwitch){lines.push("Customer: I need a portable generator inlet installed.");lines.push("AI: Simple setup. What fuel type — natural gas or propane?");lines.push("Customer: "+(s.fuel==="nat-gas"?"Natural gas.":"Propane."));}
          else if(s.kw===0&&s.transferSwitch){lines.push("Customer: I need a transfer switch installed.");lines.push("AI: Do you need permits pulled for this?");lines.push("Customer: "+(s.permit?"Yes, we need permits.":"No, it's already approved."));}
          else{lines.push("Customer: I want to install a "+(s.kw>=22?"whole house":"standby")+" generator.");lines.push("AI: "+(s.kw>=22?"A 22kW whole house setup — that's a big system. ":"")+"What fuel type — natural gas or propane?");lines.push("Customer: "+(s.fuel==="nat-gas"?"Natural gas.":"Propane."));if(s.wholeHouse){lines.push("AI: Will this be powering the whole house or just essential circuits?");lines.push("Customer: The whole house.");}if(s.permit){lines.push("AI: Do you need permits handled?");lines.push("Customer: Yes, please handle the permits.");}}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll have a generator specialist reach out to schedule. Thank you!");
          return lines.join("\n");
        }
        case"Bathroom Remodeling":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          if(s.type==="vanity"){lines.push("Customer: I want to update my bathroom vanity and lighting.");lines.push("AI: Nice! Is this a full tear-out of the existing vanity?");lines.push("Customer: "+(s.tearOut?"Yes, remove the old one.":"No, just swapping fixtures."));}
          else if(s.type==="tub-shower"){lines.push("Customer: I want to convert my tub to a walk-in shower.");lines.push("AI: Great upgrade. This involves a tear-out?");lines.push("Customer: "+(s.tearOut?"Yes, full tear-out.":"Partially."));lines.push("AI: "+(s.tile?"Are you planning on tile work?":"Any paint or just the conversion?"));if(s.tile)lines.push("Customer: Yes, we want tile.");lines.push("AI: "+(s.plumbingMove?"Will the plumbing need to be moved?":""));if(s.plumbingMove)lines.push("Customer: Yes, the plumbing needs to be relocated.");}
          else if(s.type==="master"){lines.push("Customer: I want a complete master bathroom remodel.");lines.push("AI: Full tear-out of everything?");lines.push("Customer: "+(s.tearOut?"Yes, start from scratch.":"Some things stay."));lines.push("AI: "+(s.tile?"Are you doing tile work?":""));if(s.tile)lines.push("Customer: Yes, we want tile floors and shower.");lines.push("AI: "+(s.plumbingMove?"Are you moving any plumbing?":""));if(s.plumbingMove)lines.push("Customer: Yes, we're reconfiguring the layout.");}
          else if(s.type==="half-bath"){lines.push("Customer: I want to remodel my half bath / powder room.");lines.push("AI: "+(s.tearOut?"Full tear-out?":"Just updating fixtures?"));lines.push("Customer: "+(s.tearOut?"Yes, gut it.":"Just updating."));lines.push("AI: "+(s.fixtures?"New fixtures too?":""));if(s.fixtures)lines.push("Customer: Yes, new vanity and toilet.");}
          else if(s.accessible){lines.push("Customer: I need an accessible shower installed.");lines.push("AI: We do ADA-compliant accessible showers. Full tear-out of the existing?");lines.push("Customer: "+(s.tearOut?"Yes, remove everything.":"Just the shower area."));}
          lines.push("AI: Great! Let me get some details. What is your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks "+first+". We'll have a remodeling consultant reach out to discuss your "+(s.type==="vanity"?"vanity update":s.type==="tub-shower"?"tub-to-shower conversion":s.type==="master"?"master bath remodel":s.type==="half-bath"?"half bath remodel":"accessible shower")+". Thank you!");
          return lines.join("\n");
        }
        case"Insulation Installation":{
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need insulation installed in my "+(s.location==="crawlspace"?"crawlspace":s.location==="garage"?"garage":s.location==="attic"?"attic":"walls")+".");
          if(s.location==="crawlspace"){lines.push("AI: Are you looking at full encapsulation with a vapor barrier?");lines.push("Customer: "+(s.vaporBarrier?"Yes, full encapsulation with vapor barrier.":"Just the insulation."));}
          else if(s.location==="attic"){lines.push("AI: "+(s.type==="spray-foam"?"Spray foam is great for air sealing. ":"Blow-in is cost-effective. ")+"What R-value are you aiming for?");lines.push("Customer: We're targeting R-"+s.rValue+".");}
          else if(s.location==="walls"){lines.push("AI: We inject cellulose or spray foam into the wall cavities. What R-value are you looking for?");lines.push("Customer: We want R-"+s.rValue+".");}
          else{lines.push("AI: What's the square footage?");lines.push("Customer: About "+s.sqft+" square feet.");lines.push("AI: What R-value are you looking for?");lines.push("Customer: R-"+s.rValue+".");}
          lines.push("AI: "+(s.airSealing?"Do you need air sealing done too?":""));
          if(s.airSealing)lines.push("Customer: Yes, air seal as well.");
          lines.push("AI: "+(s.vaporBarrier&&s.location==="crawlspace"?"We'll do a full encapsulation with vapor barrier.":"Let me get your info.")+" Your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          return lines.join("\n");
        }
        default:{
          // Fallback generic transcript
          let lines=[];
          lines.push("AI: Thank you for calling NorthStar. My name is Alex. How can I help you today?");
          lines.push("Customer: I need "+s.label.toLowerCase()+".");
          lines.push("AI: Great, I can help with that. What's your name?");
          lines.push("Customer: "+name+".");
          lines.push("AI: Thanks "+first+"! And a phone number I can reach you at?");
          lines.push("Customer: "+phone+".");
          lines.push("AI: Perfect. And what's the address for the service?");
          lines.push("Customer: "+addr+".");
          lines.push("AI: Thanks, I'll have an estimator reach out to schedule a time. Thank you!");
          return lines.join("\n");
        }
      }
    }
    function genCall(){
      const svc=services[Math.floor(Math.random()*services.length)];
      const s=svc.scenarios[Math.floor(Math.random()*svc.scenarios.length)];
      const price=null;
      const det=fmtDetail(svc,s);const bdl=[];
      const fn=fNames[Math.floor(Math.random()*fNames.length)];
      const ln=lNames[Math.floor(Math.random()*lNames.length)];
      const name=fn+" "+ln;
      const num=Math.floor(Math.random()*8999)+100;
      const sn=sNames[Math.floor(Math.random()*sNames.length)];
      const st=sTypes[Math.floor(Math.random()*sTypes.length)];
      const ac=aCodes[Math.floor(Math.random()*aCodes.length)];
      const phone="("+ac+") 555-"+(Math.floor(Math.random()*8999)+1000);
      const durSec=Math.floor(Math.random()*(120-60)+60);
      const durMin=Math.floor(durSec/60);
      const durRem=durSec%60;
      const dayRoll=Math.random();
      const daysAgo=dayRoll<0.4?0:dayRoll<0.65?1:dayRoll<0.85?2:Math.floor(Math.random()*3)+3;
      const dayLabel=daysAgo===0?"Today":daysAgo===1?"Yesterday":daysAgo+" days ago";
      const hrs=Math.floor(Math.random()*11)+8;
      const mins=Math.floor(Math.random()*60);
      const time=dayLabel+", "+hrs+":"+(mins<10?"0":"")+mins+" "+(hrs>=12?"PM":"AM");
      const status="answered";
      const outcomes=["appointment-set","lead-captured","follow-up","no-interest"];
      const weights=[0.4,0.3,0.2,0.1];
      let rr=Math.random(),outcome=outcomes[0];
      for(let i=0;i<weights.length;i++){rr-=weights[i];if(rr<=0){outcome=outcomes[i];break;}}
      return{
        caller:name,phone:phone,
        address:num+" "+sn+" "+st,service:svc.name,icon:svc.icon,
        avgPrice:price,jobDetail:det,
        duration:durMin+":"+(durRem<10?"0":"")+durRem,
        status:status,outcome:outcome,time:time,receivedAt:new Date().toISOString(),
        summary:svc.name+": "+s.label+". "+det+". Polaris estimate unavailable until server processing.",
        priceBreakdown:"",
        transcript:genTranscript(svc,s,name,phone,num,sn,st),
        pricingBreakdown:[]
      };
    }
// Filter state is managed by the page-specific inline script
function matchSearch(c,q){
  if(!q)return true;
  const l=q.toLowerCase();
  return (c.caller&&c.caller.toLowerCase().includes(l))||
    (c.phone&&c.phone.toLowerCase().includes(l))||
    (c.address&&c.address.toLowerCase().includes(l))||
    (c.service&&c.service.toLowerCase().includes(l))||
    (c.transcript&&c.transcript.toLowerCase().includes(l))||
    (c.summary&&c.summary.toLowerCase().includes(l));
}
function isToday(d){const t=new Date();return d.getDate()===t.getDate()&&d.getMonth()===t.getMonth()&&d.getFullYear()===t.getFullYear();}
function isThisWeek(d){const t=new Date();const w=t.getTime()-t.getDay()*86400000;return d.getTime()>=w;}

// ════════════════════════════════════════════════════════════════════════════
// POLARIS-006: Route genCall() through the unified App Store + EventBus.
// The original genCall() above is preserved verbatim; this wrapper adds the
// store side-effect without changing call shape or any existing callers.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  var originalGenCall = genCall;
  function routedGenCall() {
    var call = originalGenCall();
    try {
      if (window.AppStore && typeof window.AppStore.addLead === 'function') {
        var storedLead = window.AppStore.addLead(call);
        if (storedLead) call = storedLead;
      }
    } catch (e) { console.warn('[simulator] store addLead failed:', e); }
    try {
      if (window.EventBus && typeof window.EventBus.emit === 'function') {
        window.EventBus.emit('call:generated', call);
      }
    } catch (e) { /* non-fatal */ }
    return call;
  }
  // Replace both the local and global references so all current callers get
  // the routed version transparently.
  genCall = routedGenCall;
  if (typeof window !== 'undefined') window.genCall = routedGenCall;
})();
